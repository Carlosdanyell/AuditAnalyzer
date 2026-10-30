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

**Extrações largas (Fase 9, módulo `ct2Integrity`).** A extração da CT2 tem ~80 colunas, guardadas inteiras na base:
- Leitura genérica de uma aba (`ingest/readSheet.ts`), comum aos módulos: SHA-256, diretório do ZIP, CRC32 e tamanho
  de todas as entradas, strings compartilhadas e as linhas da aba escolhida pelo módulo, uma a uma. O CFGR700 segue
  com o próprio caminho (`ingest/pipeline.ts`), sem mudança.
- Números em typed arrays que crescem em **blocos fixos** de 65.536 linhas (`store/chunked.ts`): sem dobrar o tamanho a
  cada crescimento, o pico fica perto do que é guardado.
- Textos em colunas compactadas (`store/packedColumn.ts`): nada enquanto a coluna está vazia ou constante; um código
  de 1, 2 ou 4 bytes por linha numa tabela dos valores distintos; números de 8 bytes quando há muitos números
  distintos; e, para colunas de textos quase todos distintos (históricos, sequências), os **bytes UTF-8 de cada
  linha** em blocos de 1 MB mais 4 bytes por linha, sem tabela. A tabela custa ~100 bytes por valor distinto além dos
  caracteres; a troca é decidida uma vez, quando os códigos de 2 bytes deixam de bastar.
- Strings compartilhadas lidas nos **bytes** (`SharedStringsBytesParser`), cada item decodificado sozinho: cortar
  strings de um pedaço decodificado faz o motor JavaScript manter o pedaço inteiro vivo enquanto houver uma string
  dele (na medição, ~180 MB para uma sharedStrings de 80 MB).
- Parser da aba: a célula usual `<c …><v>valor</v></c>` é resolvida com uma busca só; qualquer outra forma segue o
  caminho geral, que acharia as mesmas posições (o CFGR700 também ganha).
- Ordem da base como permutação (`Uint32Array`) sobre os postos de cada parte da chave; as colunas ficam na ordem
  de leitura.
- `DecompressionStream` do Node lê adiante toda a parte comprimida da aba (sem contrapressão); no navegador o fluxo
  tem contrapressão. Por isso a memória medida no Node usa o `fflate` (`docs/MEDICOES.md`).

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

### 2.1 Análise segregada por tipo de saldo (seção 13 de REGRAS_CFGR700.md)

`engine/balancePhases.ts`, funções puras, só typed arrays (nenhum objeto por evento):
- **Linha do tempo** (`buildBalanceTimeline`, em `buildLogIndex`, uma vez por ingestão, sobre todos os arquivos): os
  eventos são os grupos consecutivos do índice B; dentro de cada (Recno, segundo) são reordenados pela ordem de leitura
  da primeira linha, que é a ordem `(Recno, dataHora, ord)`. Por evento: posição da 1ª linha em `byEvent` (`Int32Array`),
  tipo de saldo antes do evento (`Int32Array`, índice em `balanceValues`; −1 = não determinado), fonte, fase
  (`Uint8Array`) e marcas/exceções (`Uint16Array`). ~14 bytes por evento.
- **Projeção no escopo** (`buildScopePhases`, em `analyzeScope`): os eventos do escopo apontam para os mesmos eventos da
  linha do tempo (`pos`, `global`, `record`: 12 bytes por evento), de modo que o escopo de um arquivo usa a
  reconstrução consolidada. Por registro e por documento, a fase de cada categoria do painel (`Uint8Array`), a fase de
  maior precedência, a marca de exceção e, por documento, o 1º evento de inclusão e de efetivação e o indicador de
  segregação de funções.
- O modo Geral não usa nada disso: `RecordInfo`, `DocumentInfo` e o caminho das seções 4–12 ficam como estavam.
  `tests/integration/generalMode.test.ts` compara tudo o que o modo Geral mostra com o registro feito antes da seção 13.
- Invariantes 12–15: `segregationChecks` em `engine/checks.ts`, chamados pela ingestão por arquivo e no consolidado.

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

Fase 8 (plataforma de módulos, seção 9): o `ingest` ganhou `module?: ModuleId` (ausente = `cfgr700`); as demais
mensagens seguem o módulo da sessão e nenhum evento mudou. O handler (`src/worker/handler.ts`) guarda a sessão devolvida
pelo módulo e limita `page` a 2.000 linhas.

Fase 9: comando `probe` (`{ requestId, files, rows }`) com as primeiras linhas de cada aba de cada arquivo
(`ingest/probe.ts`: lê só o começo das abas e da sharedStrings, até a última string usada), para o aviso de arquivo
trocado; responde `null` para o arquivo que não consegue ler e nunca envia erro. `reconciliation` e `ready` levam a
carga do módulo da sessão (`ModuleReconciliation`, `ModuleSummary`): as do `ct2Integrity` têm `module:
'ct2Integrity'`; as do CFGR700 continuam sem marca, com o mesmo conteúdo. O `ingest` recebe `config: unknown`,
validada pelo módulo. A etapa `sort` entrou em `Stage`.

Seção 13: `PanelData.segregated` traz, para o período, as categorias por fase (`byPhase`), os eventos por fase e
operação, as exceções, os informativos, as marcações e a segregação de funções. A tabela `segregation` tem uma linha por
evento; `TableFilter` ganhou `phase` (com `category`, filtra os lançamentos/documentos da categoria naquela fase; na
tabela de eventos, a fase do evento), `operation`, `exception` (`'any'` = qualquer exceção), `informative` e `mark`.

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
  Alteracoes, Desbalanceados, Alteracoes_Descartadas_Detalhe, Alteracoes_Descartadas_Resumo, Segregacao (seção 13:
  uma linha por evento), Criterios, Rastreabilidade, Auxiliar.
- A importação de justificativas lê só as abas de justificativa, Rastreabilidade, Documentos e Base_Linhas.
- Saída: `Blob` → `URL.createObjectURL` → download; revogar a URL em seguida.

Implementação (Fase 5): `export/xlsxWriter.ts` (gerador: pedaços de 64 KB por aba, data fixa nas entradas do ZIP
para saída determinística, limite de 1.048.576 linhas por aba), `export/labels.ts` (textos em português e inglês,
inclusive os valores que as fórmulas comparam), `export/theme.ts` (padrão visual: paleta, formatos e estilo por tipo
de coluna — texto, quantidade, valor, data, Sim/Não; larguras e alturas calculadas) e `export/paperwork.ts`
(montagem das abas). Compressão nível 3: a geração fica ~30% mais rápida que no nível 6, com arquivo um pouco maior. `ExportOptions` =
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
Implementado (Fase 3): atalhos de período próprios e feriados, enviados ao worker pelo comando `settings` durante a
sessão, sem reprocessar os arquivos. Dados do log nunca vão para o IndexedDB.
Interface: a preferência de tema (claro/escuro) fica no mesmo store `config`, chave `uiTheme` (`src/app/themeStore.ts`).
Fase 6: **uma configuração** guardada no IndexedDB (store `config`, chave `analyzerConfig`, `src/app/configStore.ts`),
com atalhos e feriados dentro dela (os salvos à parte antes são migrados na primeira abertura). `schemaVersion` 2,
com migração da versão 1 (`src/shared/configTools.ts`: `readConfig` valida e dá erros em português por campo;
`configDiff` lista as diferenças em relação ao padrão; `configHash` é o SHA-256 do conteúdo com chaves ordenadas;
`configToJson` exporta). Tela **Configuração** (`src/app/views/ConfigView.tsx`, auxiliares puros em
`src/app/configEditor.ts`): formulário das regras, editor JSON para a estrutura do relatório, importar/exportar,
restaurar padrão. A análise usa a configuração salva; mudou fora de atalhos e feriados, a tela oferece reprocessar
com os mesmos arquivos. A Rastreabilidade da planilha traz o SHA-256 e a lista de diferenças em relação ao padrão.
Fase 4: store `justifications` (versão 2 do banco) com as justificativas (chave `tipo|documento`) e, no store
`config`, a data da última cópia em JSON e da última alteração. A tela envia as justificativas ao worker
(`setJustifications`); a importação de planilha é lida no worker (`importJustifications`, mesmo leitor de ZIP/XML).
Fase 8 (plataforma de módulos): o banco continua na versão 2; no store `config` entram chaves novas.

| Chave | Conteúdo |
|---|---|
| `analyzerConfig:cfgr700` | configuração do módulo CFGR700 (com os feriados da plataforma em `calendar.holidays`) |
| `analyzerConfig` | a mesma configuração, gravada junto em todo salvamento: chave da versão 1.0.0, mantida como espelho para que uma aba aberta com a versão anterior use as regras atuais |
| `platformConfig` | `{ schemaVersion: 1, holidays }`: feriados da plataforma, usados por todos os módulos |
| `analyzerConfig:ct2Integrity` | configuração do módulo Integridade da CT2 (Fase 10; esquema próprio, versão 2) |
| `lastModule` | última análise usada (`src/app/moduleStore.ts`) |
| `uiTheme`, `panelSettings` (antiga, migrada e apagada), metadados das justificativas | como antes |

`src/shared/configStorage.ts` decide, como função pura (`planConfigLoad`), o que ler e gravar; `configStore.ts` aplica
numa única transação. Regras: na primeira abertura depois da 1.0.0, a chave antiga é copiada para a do módulo e os
feriados para `platformConfig`; espelho diferente da chave do módulo = gravação de uma versão anterior, adotada;
chave do módulo ilegível (ex.: gravada por uma versão mais nova) não é sobrescrita e o espelho é usado, com aviso;
`platformConfig` inválida é ignorada e regravada; uma configuração válida salva nunca é trocada pelo padrão (se a
gravação de volta falhar, por exemplo com o disco cheio, as regras lidas continuam valendo, com aviso). Os
feriados da plataforma são copiados sem reordenar para `calendar.holidays`, de modo que o worker recebe o mesmo objeto
de antes: o SHA-256 e as diferenças da Rastreabilidade não mudam.
Cópia de segurança (`src/shared/backup.ts`): versão 2 = versão 1 + `platform` (feriados); versão 3 = versão 2 +
`modules` (configurações dos outros módulos, Fase 10); na leitura, os feriados de `platform` são copiados para a
configuração. A versão 1 continua sendo lida (feriados vindos da configuração);
`tests/synthetic/backups/backup-v1.json` é uma cópia gerada pela 1.0.0 que precisa ser restaurada sem perda.

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
- **Análise segregada (seção 13):** `tests/synthetic/segregationFixture.ts` tem um caso por regra (inclusão, alteração
  e efetivação em 9, exclusão em 9, alteração e exclusão em 1, inclusão direta em 1, reabertura seguida de alteração,
  Recno sem inclusão com e sem efetivação posterior, efetivação com alteração de conteúdo, carimbo em 1, efetivação e
  alteração no mesmo segundo nas duas ordens, mesmo usuário e usuários diferentes, inclusão em etapas, outro tipo de
  saldo, arquivo isolado × consolidado). `tests/unit/balancePhases.test.ts` confere evento a evento;
  `tests/unit/segregationChecks.test.ts`, os invariantes 12–15 (inclusive quebrando cada regra);
  `tests/integration/segregatedPanel.test.ts`, a soma das fases = modo Geral em todos os escopos e períodos e cada número
  = total da tabela aberta; `tests/integration/segregationExport.test.ts`, a planilha (quadro 8 do Resumo = painel).
- **Regressão do modo Geral:** `tests/synthetic/expected/generalMode.json` registra, antes da seção 13, tudo o que o
  modo Geral mostra para os casos sintéticos (estatísticas, verificações, painéis de todos os atalhos, tabelas e a
  planilha avaliada); `tests/integration/generalMode.test.ts` admite só acréscimos.
- **Locais (não versionados):** `local/*.xlsx` + `local/golden.json`. `npm run test:local` pula se a pasta não existir.
- **Exportação:** `tests/support/xlsxEval.ts` relê o XLSX gerado e avalia as fórmulas (subconjunto do Excel usado
  pela planilha). Os testes sintéticos conferem o Resumo com o painel para cada atalho, períodos personalizados e
  data de corte, nos dois idiomas; as fórmulas das justificativas (inclusive a confirmação no Excel), a volta das
  justificativas pela importação, o determinismo, o bloqueio por verificação e os invariantes 9 e 10.
  Local: `tests/local/paperwork.test.ts` faz o mesmo com os arquivos reais (e as justificativas de uma planilha
  anterior em `local/`), e `tests/local/excel.test.ts` (Windows, `EXCEL_CHECK=1`) abre a planilha no Excel por
  automação, recalcula cada atalho e confere célula a célula, sem erros de fórmula e sem reparo ao abrir.
- **Ponta a ponta (Fase 7, rodam no CI):** Playwright (`tests/e2e/`) sobre o build de produção servido pelo
  `vite preview`, com a CSP real e arquivos sintéticos: arquivos e processamento, cancelar, painel (número → tabela,
  orientação de alterados sem documento), justificativas (escrever, JSON, importar), exportação em PT e EN com o
  Resumo conferido pelo avaliador, configuração (salvar, reprocessar, persistir, cópia de segurança) e ajuda. Todo
  teste reprova requisição fora da origem e erro não tratado. Localmente usam o Chrome instalado (`E2E_CHANNEL`).
- **Plataforma de módulos (Fase 8):** `tests/unit/moduleRegistry.test.ts` (registro, hash padrão, âncora da ajuda,
  nenhum código compartilhado compara ids de módulo), casos novos em `tests/unit/workerHandler.test.ts` (o `ingest`
  com `module: 'cfgr700'` dá os mesmos eventos e os mesmos bytes exportados que sem `module`; módulo indisponível ou
  nome de membro de objeto recusado; capacidades opcionais), `tests/unit/configStorage.test.ts` (cada caso da
  migração, com idempotência), `tests/unit/backupV1.test.ts` e `tests/e2e/modules.spec.ts` (seletor, "Trocar
  análise", `lastModule`, chave da 1.0.0 semeada no IndexedDB e cópia da 1.0.0 restaurada).

## 9. Plataforma de módulos (a partir da Fase 8)

O app passa a hospedar módulos de análise independentes sobre a mesma infraestrutura (leitura em fluxo, worker,
gerador XLSX, tema, rastreabilidade). O contrato de um módulo, o que é compartilhado e a estrutura de pastas alvo
estão em `docs/MODULOS.md`. Tudo o que está acima descreve o módulo `cfgr700`; o módulo `ct2Integrity` está em
`docs/REGRAS_CT2_INTEGRIDADE.md` (a seção 7 descreve a planilha amarrada por fórmulas, que usa agregação por blocos
contíguos em vez de SUMIFS por linha).

Implementado na Fase 8:
- `src/shared/modules/index.ts`: `MODULE_IDS`, `ModuleId`, `DEFAULT_MODULE_ID` (`cfgr700`).
- Tela: `src/modules/registry.ts` com um descritor por módulo (`src/modules/<id>/module.ts`, sem React): textos do
  seletor e da tela inicial, arquivos aceitos, âncora da ajuda, recursos (`justifications`) e configuração. O
  `ct2Integrity` é um cartão "Em breve". O seletor da tela inicial deu lugar, depois da Fase 9, ao início da
  plataforma com uma linha por ferramenta (`src/components/ToolHome.tsx`; `docs/INTERFACE.md`, item 0).
- Worker: `src/worker/modules/registry.ts` (`WORKER_MODULES`, consulta só por chave própria) e o adaptador
  `src/worker/modules/cfgr700/index.ts`, que valida a configuração (`configure`) e devolve, a cada ingestão, uma
  sessão nova sobre `runIngestion` + `Session` (que não mudaram). Atalhos/feriados (`settings`) e justificativas são
  capacidades opcionais da sessão; sem elas, o handler responde "Recurso não disponível nesta análise.".
- Imports estáticos (sem `import()` sob demanda): a CSP não muda e não há arquivos buscados depois do carregamento.
- O `App.tsx` continua hospedando as visões do CFGR700; a extração da área de trabalho por módulo fica para a Fase 12.

Implementado na Fase 9:
- Tipos do CFGR700 em `src/shared/modules/cfgr700.ts` (reexportados por `protocol.ts`); tipos da CT2 em
  `src/shared/modules/ct2Integrity.ts`.
- `ct2Integrity` registrado no worker (`src/worker/modules/ct2Integrity/`: `ingest.ts`, `store.ts`, `order.ts`,
  `values.ts`) e disponível na tela como **prévia**: leitura, reconciliação e invariantes CI-1, CI-2 e CI-4.
- Descritor da tela com `preview`, passos de "Como funciona", etapas do processamento (`progress`), visões oferecidas
  (`features`; as demais aparecem bloqueadas), `config.saved` (configuração salva ou padrão do módulo) e `detect()`.
- Tela de reconciliação por módulo: `Ct2ReconciliationView` reaproveita as partes comuns (`ReconciliationParts`) da do
  CFGR700, cujo HTML não mudou (referência congelada em `tests/synthetic/expected/screens`).

Implementado na Fase 10 (motor da CT2, funções puras em `src/worker/modules/ct2Integrity/`):
- `aggregate.ts`: documentos, lotes, dias e segmentos como blocos contíguos da base (cada nível aponta o primeiro item
  do nível de baixo), com débito e crédito em centavos por posição da base e por bloco.
- `analysis.ts` + `marks.ts`: os testes da configuração como marcas (um bit por teste em `Uint32Array` por linha,
  documento, lote e dia), B4 com o documento que compensa, a lista de exceções (teste e item, em blocos fixos), o
  quadro de testes e as vistas de um item (`documentRef`, `exceptionRow`) para as tabelas e a planilha.
- `profile.ts` (P1, P2, os 10 maiores documentos), `tuples.ts` (chaves distintas por tabela de dispersão: CI-6 e o
  documento sem segmento do P3) e `checks.ts` (CI-3, CI-5, CI-6, CI-9, CI-10).
- A análise roda na mesma ingestão, na etapa `documents` ("Aglutinação e testes"); a sessão guarda a base e a análise
  e solta as chaves de ordenação. O resumo (`Ct2Summary.analysis`) leva os parâmetros, o quadro de testes e o total de
  exceções; os invariantes da análise entram na lista de verificações.

Implementado na Fase 11 (planilha da CT2):
- `src/worker/export/common/`: o que toda planilha usa — `traceability.ts` (`TraceSheet`: células mescladas, títulos,
  pares rótulo/valor, diferenças da configuração e verificações da aba Rastreabilidade) e `guards.ts` (verificações
  bloqueantes que exigem confirmação e nenhuma data anterior a 1901). A planilha do CFGR700 passou a usá-los sem mudar
  um byte (SHA-256 das exportações pt e en comparado antes e depois).
- `src/worker/modules/ct2Integrity/workpaper.ts` (+ `workpaperLabels.ts`): a planilha amarrada da seção 7 de
  `docs/REGRAS_CT2_INTEGRIDADE.md`, escrita em fluxo pelo mesmo `XlsxWriter`, que ganhou a opção de impressão
  `fitToWidth` (paisagem, uma página de largura). A sessão do módulo oferece `export`.
- Tela: `ExportView` recebe o conteúdo do módulo (`ExportContent`); o do CFGR700 é o mesmo de antes
  (`cfgr700ExportContent`), o da CT2 está em `src/app/views/ct2Export.tsx`.
- Avaliador de testes (`tests/support/xlsxEval.ts`): `ROWS`, `COUNTA`, `WEEKDAY` (tipo 2), `COUNTIF`, `SUMIF`, `EXACT`, e
  critério numérico de igualdade que também casa com o texto numérico, como o Excel.

Implementado na Fase 12 (painel e tabelas da CT2):
- Worker: `analyze` reaplica a análise sobre a mesma base (a sessão guarda as chaves de ordenação para isso: 11 colunas
  de 4 bytes por linha, ~57 MB com 1,3 milhão de linhas, já contadas no "mantido" das medições da Fase 10);
  `panel.ts` (painel por segmento), `segments.ts` (segmento de cada bloco e posição), `tables.ts` (tabelas paginadas,
  índices em typed arrays, cache por tabela, filtro e ordenação). Cada número do quadro abre uma tabela com o mesmo
  total, igual ao Resumo da planilha (`tests/unit/ct2Tables.test.ts`).
- Tela: `src/app/modules/workspace.ts` (contrato), `src/app/modules/cfgr700/Cfgr700Workspace.tsx` (as visões do CFGR700,
  tiradas do `App.tsx` sem mudar o que aparece) e `src/app/modules/ct2Integrity/` (`Ct2Workspace`, `Ct2PanelView`);
  `TablesView` recebe as abas e os filtros de cada módulo (`originFilters`, `toolbar`).

