# Interface — contrato para recriar as telas

Este documento serve para quem for redesenhar a interface (pessoa ou agente). A aparência pode mudar à vontade;
**os comportamentos abaixo não podem se perder**, e as restrições do `CLAUDE.md` continuam valendo.

## Fronteira

- A interface fica em `src/app/` e `src/components/`. Motor, leitura e exportação (`src/worker/`), configuração
  (`src/config/`) e funções compartilhadas (`src/shared/`) **não precisam mudar** para redesenhar a tela.
- A interface conversa com o processamento só por `WorkerClient` (`src/app/workerClient.ts`) e pelos tipos de
  `src/shared/protocol.ts`:
  - `send({ type: 'ingest', files, config })` e eventos `progress`, `reconciliation`, `ready`, `error`;
  - `query(...)` com resposta pelo mesmo `requestId`: `panel`, `page`, `settings`, `setJustifications`,
    `importJustifications`, `export` (respostas `exported` ou `exportBlocked`);
  - `cancel()` encerra o worker (descarta os dados da sessão).
- Lógica que já existe e deve ser reaproveitada, não reescrita:
  - `src/shared/format.ts` (números, datas, reais — formatação pt-BR só aqui);
  - `src/shared/justifications.ts` (`mergeImport`, `findConflicts`, `buildJsonExport`, `justificationKey`);
  - `src/shared/configTools.ts` (`readConfig`, `configDiff`, `configHash`, `configToJson`);
  - `src/app/configEditor.ts` (edição por caminho, listas, reais ↔ centavos, erros por campo);
  - `src/app/configStore.ts` e `src/app/justificationStore.ts` (IndexedDB), `src/app/download.ts` (salvar arquivo).

## Restrições que afetam a tela

- Nenhuma chamada de rede, CDN ou fonte externa; manter a CSP de `index.html`. Sem novas dependências sem
  justificativa (tamanho, manutenção, rede).
- Listas grandes sempre virtualizadas (TanStack Virtual já usado em `TablesView`); a tela nunca recebe o log
  inteiro — só páginas (`page`) de até 2.000 linhas.
- Thread principal abaixo de 150 MB e sem travar: nada de processamento pesado na tela.
- Nenhum dado do log em `localStorage`, `sessionStorage`, Cache Storage ou service worker. IndexedDB só para
  configuração e justificativas.
- Textos em português; fonte `Aptos, "Segoe UI", system-ui, sans-serif`; sem baixar fontes.
- Aviso permanente: "Os arquivos são processados neste computador e não são enviados para nenhum servidor."

## Telas e comportamentos obrigatórios

1. **Arquivos** — soltar ou escolher um ou mais `.xlsx`; a ordem define a ordem das fontes; remover arquivo;
   Analisar (envia a configuração salva). Mensagens de erro com detalhe técnico recolhido.
2. **Processamento** — etapa atual, progresso por arquivo e total, linhas lidas, linhas/segundo, tempo decorrido e
   **Cancelar** (termina o worker e avisa que os dados lidos foram descartados).
3. **Reconciliação** — por arquivo: SHA-256, integridade do ZIP, parâmetros, reconciliação de linhas, eventos por
   operação e verificações (bloqueantes e alertas); resumo da análise por escopo.
4. **Painel** (`panel`) — escopo (cada arquivo e Consolidado); período por atalho (inclui os do usuário) ou datas;
   data de corte editável; quadros: categorias por origem (cada número abre a tabela filtrada por categoria,
   período e origem), período × demais dias × log completo, competência (com o indicador de fechamento),
   sinalizações (Ação/Informativo/OK), aviso de justificativas não carregadas, **orientação para registros sem
   documento** (`identification`: um arquivo → carregar a extração anterior; escopo de arquivo → "Ver no
   Consolidado" mantendo o período; demais → extração anterior ou CT2 pelo Recno; link para os registros),
   cobertura das justificativas (números abrem as listas), movimento diário; salvar atalhos e feriados.
5. **Tabelas** (`page`) — tabela, busca, ordenação, filtros vindos do painel, paginação e rolagem virtualizada;
   colunas definidas pelo worker (tipos: texto, inteiro, dinheiro em centavos, data, data/hora).
6. **Justificativas** — listas de exclusão e de alteração (tabelas `deletionJustifications` e
   `changeJustifications`, com valor do documento, valor excluído e histórico); editor (texto, responsável, copiar
   da outra lista, confirmar que abrange o novo evento); importar planilha exportada ou JSON com prévia, cobertura
   escolhível e conflitos lado a lado; exportar cópia em JSON; data da última cópia e aviso de alterações sem cópia;
   contagem de chaves sem documento no log atual; ajuda "Como funciona".
7. **Exportação** (`export`) — escopo, idioma (português/inglês), lista de verificações bloqueantes com caixa de
   confirmação (sem ela o botão não gera), progresso por etapa, download com `downloadBlob`, mensagem com nome e
   tamanho.
8. **Configuração** — seções do formulário, erros por campo (`readConfig`), importar/exportar JSON, restaurar
   padrão, diferenças em relação ao padrão e SHA-256, editor JSON avançado, salvar (`applyConfig` do App).
   Com análise na tela e configuração alterada (fora atalhos e feriados), aviso **"Reprocessar com esta
   configuração"**, que reaproveita os arquivos carregados.
9. **Geral** — "Nova análise", "Encerrar sessão" (termina o worker e limpa a tela), botão "Exportar planilha",
   aviso de configuração salva inválida, aviso de reprocessamento na tela principal.

## Como validar

- `npm run test`, `npm run lint` e `npm run build` passando (há testes de tela em `tests/unit/App.test.tsx` e
  `tests/unit/ReconciliationView.test.tsx`; ajuste-os ao novo layout sem remover o que verificam).
- Percorrer as telas com os dois arquivos grandes: a tela não pode travar durante leitura, navegação e exportação.
- Nenhum dado real, nome de empresa ou de pessoa em arquivos versionados.
