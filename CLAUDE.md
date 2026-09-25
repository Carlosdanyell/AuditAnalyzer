# AuditAnalyzer — contexto do projeto

## O que é

Ferramenta web interna, 100% no navegador, para analisar o relatório de log de auditoria **CFGR700 do TOTVS Protheus**
(hoje, tabela **CT2** — lançamentos contábeis) e gerar um papel de trabalho auditável em Excel.

O usuário é contador. Ele recebe um ou mais arquivos `.xlsx` do CFGR700 (cada um com ~600 mil a ~1 milhão de linhas),
precisa responder a perguntas de auditoria interna/SOX (exclusões, alterações, desbalanceamentos, postagens,
por período e por origem manual/automática) e entregar uma planilha com a análise, as justificativas e a
reconciliação que prova que nada ficou de fora.

A lógica de negócio já foi validada manualmente em Python contra entregas reais. Este projeto a reimplementa
em TypeScript, de forma configurável, com interface própria. As regras estão em `docs/REGRAS_CFGR700.md`
e a arquitetura em `docs/ARQUITETURA.md`. **Leia os dois antes de escrever código.**

## Restrições inegociáveis

1. **Nada sai da máquina.** Sem backend, sem chamadas de rede em tempo de execução, sem analytics, sem CDN,
   sem fontes externas. O app é publicado no GitHub Pages apenas como arquivos estáticos. Manter a
   Content-Security-Policy definida em `index.html` (`connect-src 'self'`).
2. **Sem instalação no computador do usuário.** Roda em Chrome/Edge corporativo gerenciado. Nada de extensões,
   nada de executáveis, nada de scripts locais.
3. **Memória controlada.** O arquivo nunca é carregado inteiro como texto ou objeto. Leitura em fluxo
   (ZIP → inflate → XML em partes), armazenamento colunar em typed arrays com dicionário de strings.
   Metas: pico do worker < 400 MB com dois arquivos (~1,3 milhão de linhas de detalhe); thread principal < 150 MB.
4. **Sem cache de dados.** Dados do log ficam só na memória do worker durante a sessão. IndexedDB apenas para
   configuração e justificativas (pequenos). Nenhum dado em localStorage, Cache Storage ou service worker.
5. **Integridade verificável.** Toda execução calcula SHA-256 dos arquivos de entrada, confere CRC32 e tamanho
   de cada entrada do ZIP, reconcilia contagens de linhas e eventos e roda invariantes. Invariante que falha
   bloqueia a exportação (ou exige confirmação explícita, registrada no arquivo exportado).
6. **Determinismo.** Mesma entrada + mesma configuração = mesma saída, byte a byte na parte de dados.
   Ordenações estáveis, datas tratadas sem fuso horário, valores monetários em centavos inteiros.
7. **Repositório público.** Nada de dados reais, nomes de empresa, nomes de usuários, chaves de documentos
   ou valores reais no repositório. Testes públicos usam arquivos sintéticos. Arquivos reais e números de
   referência reais ficam em `local/` (ignorado pelo git).
8. **Interface responsiva durante o processamento.** Todo processamento pesado roda em Web Worker. A UI mostra
   etapa atual, progresso, linhas/segundo, tempo decorrido e permite cancelar.

## Stack

- Vite + React 18 + TypeScript (strict)
- Web Worker (module worker) para ingestão, processamento e exportação; comunicação tipada (Comlink permitido)
- Descompressão: `DecompressionStream('deflate-raw')` nativo; fallback `fflate` se indisponível
- Parser XML próprio, em fluxo, específico para SpreadsheetML (não usar DOMParser para a planilha)
- Tabelas: TanStack Table + TanStack Virtual (virtualização obrigatória em listas grandes)
- Validação de configuração: `zod`
- Hash: `hash-wasm` (SHA-256 incremental) ; CRC32 próprio ou `fflate`
- Exportação XLSX: **gerador próprio em fluxo** sobre `fflate` (Zip + ZipDeflate), strings inline,
  fórmulas sem valor em cache e `fullCalcOnLoad`. ExcelJS apenas se o gerador próprio ainda não existir,
  e nunca para arquivos com mais de ~50 mil linhas.
- Testes: Vitest (unidade e integração); Playwright opcional para fluxo ponta a ponta
- Estilo: CSS Modules ou Tailwind; fonte `Aptos, "Segoe UI", system-ui, sans-serif` (sem baixar fontes)

## Estrutura de pastas

```
src/
  app/                 # React: páginas, layout, estado da UI
  components/          # componentes reutilizáveis (Progress, DataTable, PeriodFilter...)
  worker/
    index.ts           # ponto de entrada do worker e protocolo de mensagens
    ingest/            # zip.ts, inflate.ts, sst.ts, sheetStream.ts, parametros.ts
    store/             # dictionary.ts, columns.ts (typed arrays), recordStore.ts
    engine/            # events.ts, records.ts, documents.ts, classify.ts, periods.ts, checks.ts
    export/            # xlsxWriter.ts, styles.ts, sheets/*.ts, traceability.ts
  config/              # schema.ts (zod), defaults/ct2.json
  shared/              # tipos compartilhados, formatação pt-BR, datas, centavos
tests/
  synthetic/           # gerador de CFGR700 sintético + respostas esperadas
  unit/ integration/
local/                 # NÃO VERSIONAR: arquivos reais e golden.json
docs/
```

## Convenções

- Código, nomes de variáveis e commits em inglês; textos da interface e da planilha exportada em português (pt-BR).
- Formatação pt-BR somente na camada de apresentação (`shared/format.ts`). A lógica nunca depende de locale.
- Datas: parse manual de `dd/mm/aaaa` e `dd/mm/aaaa hh:mm:ss`; representar como inteiros (dias ou segundos desde
  uma época fixa, sem fuso). Proibido `new Date(string)` na lógica.
- Dinheiro: converter o texto do log para centavos inteiros na leitura; somar em centavos; converter só na saída.
- Toda regra de negócio vem da configuração (`config/defaults/ct2.json`), não de constantes espalhadas.
- Toda função do motor é pura e testável fora do worker.
- Nenhuma dependência nova sem justificar no PR/commit (tamanho, manutenção, uso de rede).

## Planilha exportada — regras que já causaram problema

- Busca em outra aba (INDEX/MATCH, PROCV) **sempre** trata vazio: `=IF(INDEX(...)="","",INDEX(...))`.
  Sem isso o Excel mostra 0 ou `00/01/1900` em células de data.
- Não usar `TEXT(data;"DD/MM/YYYY")`: o código de formato depende do idioma do Excel (em pt-BR é `AAAA`).
  Gravar a data como número serial e aplicar formato de célula.
- Não gerar mesclagens sobrepostas (o Excel "repara" o arquivo e remove conteúdo). Validar antes de gravar.
- Fórmulas com nomes de função em inglês e separador `,` no XML (o Excel converte para o idioma do usuário).
- Fontes: Aptos (corpo) e Aptos Display (títulos).

## Comandos

```
npm run dev        # servidor de desenvolvimento
npm run build      # build de produção (GitHub Pages, base configurada no vite.config.ts)
npm run test       # testes sintéticos (rodam no CI)
npm run test:local # testes com arquivos reais em local/ (só na máquina do desenvolvedor)
npm run lint
```

## Definição de pronto (vale para toda tarefa)

- Testes sintéticos passando; testes locais passando quando a tarefa toca no motor ou na ingestão.
- Nenhum dado real, nome de empresa ou de pessoa em arquivos versionados.
- UI continua responsiva com o arquivo grande (verificar manualmente com o arquivo de ~1 milhão de linhas).
- Invariantes novos documentados em `docs/REGRAS_CFGR700.md`.
- Mudanças de regra de negócio refletidas na configuração padrão e na documentação.

## Como trabalhar neste repositório

- Uma fase do `docs/ROTEIRO.md` por vez. Comece planejando, confirme o plano, depois implemente.
- Escreva primeiro os testes com o resultado esperado; depois o código.
- Em dúvida sobre uma regra de negócio, pergunte. Não invente critério contábil.
