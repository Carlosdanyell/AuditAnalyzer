# Arquitetura

## Visão geral

```
┌──────────────────────── Navegador (Chrome/Edge) ────────────────────────┐
│                                                                          │
│  Thread principal (React)                  Web Worker (motor)            │
│  ─────────────────────────                 ───────────────────────────── │
│  Upload (File)  ──── File (sem cópia) ───▶ ingest: ZIP → inflate → XML   │
│  Progresso      ◀─── eventos de progresso  store: dicionário + colunas   │
│  Validação      ◀─── reconciliação         engine: eventos, registros,   │
│  Painel         ◀─── agregados (pequenos)          documentos, períodos  │
│  Tabelas        ◀─── páginas (offset/limit)                              │
│  Exportar       ◀─── Blob do .xlsx         export: gerador XLSX em fluxo │
│                                                                          │
│  IndexedDB: só configuração e justificativas                             │
└──────────────────────────────────────────────────────────────────────────┘
```

O worker é dono dos dados. A thread principal nunca recebe a base inteira: recebe agregados para o painel e
páginas de linhas para as tabelas virtualizadas.

---

## 1. Leitura do arquivo (ingestão)

### 1.1 ZIP com acesso aleatório
- `File` é um `Blob`: ler o final (últimos ~66 KB) para achar o End of Central Directory e o diretório central.
- Para cada entrada: offset do cabeçalho local, método (0 = stored, 8 = deflate), tamanhos, CRC32.
- Ler `sharedStrings.xml` **antes** da aba grande, mesmo que venha depois no ZIP.
- Stream da entrada: `blob.slice(ini, fim).stream().pipeThrough(new DecompressionStream('deflate-raw'))`.
  Fallback: `fflate.Inflate` em blocos se `deflate-raw` não for suportado.
- Calcular CRC32 e contar bytes do fluxo descomprimido; comparar com o diretório central (integridade).
- ZIP64: detectar; se aparecer, suportar ou falhar com mensagem clara.

### 1.2 XML em fluxo
- `TextDecoderStream('utf-8')` → parser próprio orientado a eventos, só para as tags usadas:
  `<row r>`, `<c r t s>`, `<v>`, `<is><t>`, e na sharedStrings `<si>`, `<t>`, `<r>`, `<rPh>`.
- Tratar tags e entidades quebradas entre dois pedaços (guardar o resto do pedaço anterior a partir do último `<`).
- Não usar regex sobre o arquivo inteiro nem DOMParser.
- Coluna pela letra do atributo `r` da célula; linha pelo `r` da `<row>` (lacunas = linhas em branco).

### 1.3 Armazenamento colunar
- Dicionário global de strings: `Map<string, number>` + `string[]`. A sharedStrings de cada arquivo vira um
  `Int32Array` de remapeamento (índice local → id global). As strings são guardadas uma única vez.
- Colunas das linhas de detalhe como `Int32Array` pré-alocados pelo `<dimension>`:
  `field`, `oldVal`, `newVal`, `user`, `op`, `dateTime`, `recno`, `source`, `ord`.
  (`Tipo Dados`, `Situacao`, `Tipo Dado Protegido`: guardar só contagens para a reconciliação, salvo necessidade.)
- Estimativa: 1,3 milhão de linhas × 9 colunas × 4 bytes ≈ 47 MB.
- Implementação (Fase 1, `store/columns.ts`): `ord` é a própria posição da linha na base (leitura em ordem:
  arquivo 1 inteiro, depois arquivo 2), sem coluna própria. `op` e `source` são `Uint8Array`; `dateTime` já
  guarda os segundos (inválido = `INVALID_TIME`). Total ≈ 26 bytes por linha (~34 MB para 1,3 milhão).
- A aba do relatório é lida direto nos **bytes** UTF-8 (`ingest/sheetStream.ts`), sem decodificar o XML inteiro
  em texto; só strings inline e valores `t="str"` são decodificados. A sharedStrings é lida como texto.
- Atributos por id do dicionário calculados uma vez: `dateTime` em segundos, `isNoise`, `isKeep`, código da operação,
  valor em centavos.
- Ao terminar a ingestão de um arquivo, descartar buffers intermediários.

### 1.4 Metas de desempenho (medir na prova de conceito)
| Métrica | Meta inicial |
|---|---|
| Arquivo de ~1 milhão de linhas (34 MB) | ingestão < 60 s em máquina corporativa comum |
| Pico de memória do worker (2 arquivos) | < 400 MB |
| Thread principal | < 150 MB, sem travar (> 30 fps durante o processamento) |

---

## 2. Motor de análise

Funções puras sobre as colunas:
1. Índice ordenado A `(recno, dateTime, ord)` → valores finais dos registros.
2. Índice ordenado B `(recno, dateTime, op, user, ord)` → eventos (grupos consecutivos).
3. Classificação das alterações (efetivação, carimbo, efetiva).
4. Registros → documentos → datas de evento por documento (por arquivo de origem nas alterações).
5. Períodos e categorias (consultas sobre arrays já calculados).
6. Invariantes.

Usar `Uint32Array` de índices e ordenação estável. Resultados como arrays de estruturas pequenas
(~30 mil registros, ~3 mil documentos): não há problema de memória nessa etapa.

---

## 3. Protocolo worker ↔ UI

```ts
type Command =
  | { type: 'ingest'; files: File[]; config: AnalyzerConfig }
  | { type: 'cancel' }
  | { type: 'panel'; period: Period }
  | { type: 'page'; table: TableId; filter?: Filter; sort?: Sort; offset: number; limit: number }
  | { type: 'setJustifications'; items: Justification[] }
  | { type: 'export'; requestId: number; options: ExportOptions };

type WorkerEvent =
  | { type: 'progress'; stage: Stage; fileIndex?: number; done: number; total: number; unit: 'bytes'|'rows'|'steps'; message: string }
  | { type: 'reconciliation'; data: Reconciliation }
  | { type: 'ready'; summary: Summary; checks: CheckResult[] }
  | { type: 'panel'; data: PanelData }
  | { type: 'page'; rows: unknown[]; total: number }
  | { type: 'exported'; requestId: number; blob: Blob; fileName: string }
  | { type: 'exportBlocked'; requestId: number; failures: CheckResult[] }
  | { type: 'error'; stage: Stage; message: string; detail?: string };
```

Progresso enviado no máximo a cada ~100 ms. Cancelar = `worker.terminate()` e criar um novo worker.

Implementação (Fase 3): `panel` e `page` levam `requestId` e `scope` (índice do escopo: cada arquivo e, com mais de
um arquivo, o consolidado); a resposta, ou o erro, devolve o mesmo `requestId` (`WorkerClient.query`). O período é
`{ startDay, endDay }` em números de dia. As tabelas são filtradas, ordenadas e paginadas no worker
(`engine/tables.ts`, com cache das últimas consultas); a tela só virtualiza as linhas (TanStack Virtual). O TanStack
Table não foi adotado: com ordenação, filtro e paginação no worker, ele não teria função.

## 4. Progresso na interface

Etapas exibidas como lista vertical com status (aguardando, em andamento, concluída, erro):

1. Conferência do arquivo (hash SHA-256, leitura do ZIP)
2. Leitura dos parâmetros
3. Leitura das strings compartilhadas
4. Leitura das linhas (barra por bytes descomprimidos / tamanho descomprimido do diretório central;
   exibir linhas lidas, linhas/segundo, tempo decorrido, estimativa)
5. Reconciliação de linhas
6. Montagem de eventos e registros
7. Documentos e classificação
8. Verificação dos invariantes

Com dois arquivos: progresso por arquivo e total. Em erro: etapa, mensagem clara em português e detalhe técnico recolhido.

## 5. Exportação XLSX

Gerador próprio em fluxo:
- `fflate.Zip` + `ZipDeflate`; cada aba escrita como sequência de pedaços de string (`<row>...</row>`).
- Strings inline (`t="inlineStr"`) para não montar sharedStrings grande em memória.
- Registro de estilos (fontes Aptos / Aptos Display, preenchimentos, bordas, formatos numéricos) gerando `styles.xml`.
- Fórmulas com `<f>` sem `<v>`, e `<calcPr fullCalcOnLoad="1"/>` no workbook.
- Nomes definidos, validação de dados (lista e data), formatação condicional, painéis congelados, autofiltro,
  larguras de coluna, mesclagens (validadas contra sobreposição).
- Abas: Resumo, Justificativa da Exclusao, Justificativa da Alteração, Documentos, Base_Linhas, Exclusoes,
  Alteracoes, Desbalanceados, Alteracoes_Descartadas_Detalhe, Alteracoes_Descartadas_Resumo, Criterios,
  Rastreabilidade, Auxiliar.
- Saída: `Blob` → `URL.createObjectURL` → download; revogar a URL em seguida.

Implementação (Fase 5): `export/xlsxWriter.ts` (gerador: pedaços de 64 KB por aba, data fixa nas entradas do ZIP
para saída determinística, limite de 1.048.576 linhas por aba), `export/labels.ts` (textos em português e inglês,
inclusive os valores que as fórmulas comparam) e `export/paperwork.ts` (montagem das abas). `ExportOptions` =
`{ scope, language: 'pt' | 'en', confirmFailures, generatedAt }`; o worker responde `exportBlocked` quando há
verificação bloqueante falhando sem confirmação. A versão (commit curto) vem do build (`__APP_VERSION__`), e o
SHA-256 da configuração é calculado na exportação. Na tela, a visão **Exportação** escolhe escopo e idioma, mostra as
falhas bloqueantes com a caixa de confirmação, o progresso por etapa e o resultado.

### Aba Rastreabilidade (obrigatória)
Versão da ferramenta (commit), data/hora da execução, hash da configuração, e por arquivo: nome, tamanho,
SHA-256, parâmetros do relatório, primeiro/último evento, reconciliação de linhas, eventos por operação,
resultado de cada invariante.

## 6. Configuração

JSON validado com zod, versionado (`schemaVersion`). Conteúdo: tabela, colunas esperadas, `keepFields`,
`noiseFields`, dicionário de campos (descrição), composição da chave do documento, mapas de origem e natureza,
tolerância de balanceamento, presets de período, data de corte de competência, sinalizações, textos da planilha.
Exportar/importar pelo usuário; cópia em IndexedDB. O hash da configuração vai para a Rastreabilidade.
Implementado (Fase 3): atalhos de período próprios e feriados são salvos em IndexedDB (`src/app/settings.ts`,
banco `auditanalyzer`, store `config`), aplicados à configuração de cada análise e enviados ao worker pelo comando
`settings` durante a sessão, sem reprocessar os arquivos. Dados do log nunca vão para o IndexedDB.
Fase 4: store `justifications` (versão 2 do banco) com as justificativas (chave `tipo|documento`) e, no store
`config`, a data da última cópia em JSON e da última alteração. A tela envia as justificativas ao worker
(`setJustifications`); a importação de planilha é lida no worker (`importJustifications`, mesmo leitor de ZIP/XML).

## 7. Segurança e privacidade

- CSP em `index.html`: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:;
  connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'`.
- Sem requisições externas; build sem CDN.
- Mensagem visível na tela inicial: "Os arquivos são processados neste computador e não são enviados para nenhum servidor."
- Botão "Encerrar sessão": termina o worker e limpa o estado.

## 8. Testes

- **Sintéticos (versionados, rodam no CI):** gerador que cria CFGR700 `.xlsx` pequenos com casos conhecidos —
  cabeçalhos repetidos, linhas ausentes no XML, texto rico na sharedStrings, entidades XML, inclusão +
  recuperação no mesmo segundo, inclusão duplicada, exclusão dupla, TPSALD 9→1, só USERGA, registro só com
  USERGA, documento misto, documento de base parcial, desbalanceado, usuário vazio, dois arquivos com o mesmo Recno.
- **Locais (não versionados):** `local/*.xlsx` + `local/golden.json`. `npm run test:local` pula se a pasta não existir.
- **Exportação:** `tests/support/xlsxEval.ts` relê o XLSX gerado e avalia as fórmulas (subconjunto do Excel usado
  pela planilha). Os testes sintéticos conferem o Resumo com o painel para cada atalho, períodos personalizados e
  data de corte, nos dois idiomas; as fórmulas das justificativas (inclusive a confirmação no Excel), a volta das
  justificativas pela importação, o determinismo, o bloqueio por verificação e os invariantes 9 e 10.
  Local: `tests/local/paperwork.test.ts` faz o mesmo com os arquivos reais (e as justificativas de uma planilha
  anterior em `local/`), e `tests/local/excel.test.ts` (Windows, `EXCEL_CHECK=1`) abre a planilha no Excel por
  automação, recalcula cada atalho e confere célula a célula, sem erros de fórmula e sem reparo ao abrir.
