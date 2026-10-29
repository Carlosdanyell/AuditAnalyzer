# Interface — contrato para recriar as telas

Este documento serve para quem for redesenhar a interface (pessoa ou agente). A aparência pode mudar à vontade;
**os comportamentos abaixo não podem se perder**, e as restrições do `CLAUDE.md` continuam valendo.

## Fronteira

- A interface fica em `src/app/` e `src/components/`. Motor, leitura e exportação (`src/worker/`), configuração
  (`src/config/`) e funções compartilhadas (`src/shared/`) **não precisam mudar** para redesenhar a tela.
- A interface conversa com o processamento só por `WorkerClient` (`src/app/workerClient.ts`) e pelos tipos de
  `src/shared/protocol.ts`:
  - `send({ type: 'ingest', module, files, config })` (`module` = análise escolhida, `src/shared/modules`) e eventos
    `progress`, `reconciliation`, `ready`, `error`;
  - `query(...)` com resposta pelo mesmo `requestId`: `panel`, `page`, `settings`, `setJustifications`,
    `importJustifications`, `export` (respostas `exported` ou `exportBlocked`);
  - `cancel()` encerra o worker (descarta os dados da sessão).
- Lógica que já existe e deve ser reaproveitada, não reescrita:
  - `src/shared/format.ts` (números, datas, reais — formatação pt-BR só aqui);
  - `src/shared/justifications.ts` (`mergeImport`, `findConflicts`, `buildJsonExport`, `justificationKey`);
  - `src/shared/configTools.ts` (`readConfig`, `configDiff`, `configHash`, `configToJson`);
  - `src/app/configEditor.ts` (edição por caminho, listas, reais ↔ centavos, erros por campo);
  - `src/app/configStore.ts`, `src/app/justificationStore.ts` e `src/app/moduleStore.ts` (IndexedDB),
    `src/app/download.ts` (salvar arquivo);
  - `src/modules/registry.ts` (descritores das análises: textos, arquivos aceitos, âncora da ajuda, recursos).

## Restrições que afetam a tela

- Nenhuma chamada de rede, CDN ou fonte externa; manter a CSP de `index.html`. Sem novas dependências sem
  justificativa (tamanho, manutenção, rede).
- Listas grandes sempre virtualizadas (TanStack Virtual já usado em `TablesView`); a tela nunca recebe o log
  inteiro — só páginas (`page`) de até 2.000 linhas.
- Thread principal abaixo de 150 MB e sem travar: nada de processamento pesado na tela.
- Nenhum dado do log em `localStorage`, `sessionStorage`, Cache Storage ou service worker. IndexedDB só para
  configuração e justificativas (as preferências de tema claro/escuro e da última análise usada ficam no mesmo store
  `config`, chaves `uiTheme` e `lastModule`; as chaves da configuração estão em `docs/ARQUITETURA.md`, seção 6).
- Textos em português; fonte `Aptos, "Segoe UI", system-ui, sans-serif`; sem baixar fontes.
- Aviso permanente: "Os arquivos são processados neste computador e não são enviados para nenhum servidor."

## Telas e comportamentos obrigatórios

0. **Início da plataforma — Ferramentas** (`docs/MODULOS.md`, seção 4) — um cartão por ferramenta (código curto,
   título, descrição, arquivo esperado, link "Manual desta análise"); o cartão inteiro é um botão com o título da
   ferramenta e abre o espaço de trabalho dela (a área de arquivos só existe ali). A última usada (`lastModule`,
   gravada ao Analisar) tem a marca "Última usada"; a ferramenta com análise carregada tem "Análise aberta" e
   "Voltar à análise". Ferramenta "Em breve" não abre; em prévia (Integridade da CT2) tem o selo "Prévia" e o aviso do
   que já faz, no espaço de trabalho e na reconciliação. Voltar às Ferramentas mantém a análise; abrir outra
   ferramenta encerra a análise aberta (o worker guarda uma por vez). Arquivo que parece ser de outra ferramenta:
   aviso "Este arquivo parece ser … Trocar de análise?" com o botão "Mudar para …", que troca e mantém a lista; o aviso
   nunca impede de analisar. **"Nova análise"** (topo) mantém a ferramenta e os arquivos.
   **Estrutura:** barra lateral com Ferramentas, a ferramenta aberta (status) e só as visões que ela oferece, depois
   Configuração, Ajuda, Encerrar sessão, o aviso de privacidade, versão, autoria e o botão de tema (ícone). Topo com a
   trilha ("Ferramentas › ferramenta · arquivos") e o título da tela numa linha; a única ação primária é
   "Exportar planilha".
   **Densidade e movimento:** o que pede atenção fica aberto (falhas, alertas, sinalizações que exigem ação); o que
   está OK fica recolhido numa linha ("N verificação(ões) OK", "N sinalização(ões) sem ocorrência"); quadros de
   consulta do painel ficam recolhidos, com o status no título. Animações só de `transform`/`opacity`, curtas
   (entradas ≈ 220 ms), e só onde dão retorno (progresso, conclusão, abrir/fechar, arrastar); nada contínuo
   decorativo; números nunca são animados (um valor de auditoria não mostra quantias intermediárias); respeitar
   `prefers-reduced-motion`.
1. **Arquivos** — soltar ou escolher um ou mais `.xlsx`; a ordem define a ordem das fontes; remover arquivo;
   Analisar (envia a configuração do módulo: a salva, ou o padrão do módulo sem configuração editável). Mensagens de
   erro com detalhe técnico recolhido.
2. **Processamento** — etapa atual, progresso por arquivo e total, linhas lidas, linhas/segundo, tempo decorrido e
   **Cancelar** (termina o worker e avisa que os dados lidos foram descartados).
3. **Reconciliação** — por arquivo: SHA-256, integridade do ZIP, parâmetros, reconciliação de linhas, eventos por
   operação e verificações (bloqueantes e alertas); resumo da análise por escopo. Integridade da CT2: linhas após o
   cabeçalho − em branco = detalhe, valores ilegíveis por tipo com as primeiras linhas de origem, colunas encontradas,
   totais por tipo de saldo e moeda (sem somar segmentos) e as verificações CI-1, CI-2 e CI-4. Visões que o módulo não
   oferece não aparecem no menu.
4. **Painel** (`panel`) — escopo (cada arquivo e Consolidado); período por atalho (inclui os do usuário) ou datas;
   data de corte editável; quadros: categorias por origem (cada número abre a tabela filtrada por categoria,
   período e origem), período × demais dias × log completo, competência (com o indicador de fechamento),
   sinalizações (Ação/Informativo/OK), aviso de justificativas não carregadas, **orientação para registros sem
   documento** (`identification`: um arquivo → carregar a extração anterior; escopo de arquivo → "Ver no
   Consolidado" mantendo o período; demais → extração anterior ou CT2 pelo Recno; link para os registros),
   cobertura das justificativas (números abrem as listas), movimento diário; salvar atalhos e feriados.
   **Seletor Geral / Segregado** (grupo de opções "Análise"; padrão Geral, mantido ao abrir uma tabela e voltar). O modo
   Geral mostra exatamente o que mostrava antes. O modo Segregado (`segregated`, seção 13 de REGRAS_CFGR700.md) mostra:
   exceções da fase Postado (1) em destaque (cada número abre a tabela de eventos filtrada), categorias por fase com a
   linha de total igual ao modo Geral (cada número abre a tabela com a fase), eventos por fase e operação, segregação
   de funções, orientação para eventos Não determinados (extrair com "Exclui campos não alterados = Não" ou consultar a
   tabela pelo Recno) e o texto de limitações da seção 13.
5. **Tabelas** (`page`) — tabela, busca, ordenação, filtros vindos do painel, paginação e rolagem virtualizada;
   colunas definidas pelo worker (tipos: texto, inteiro, dinheiro em centavos, data, data/hora). A tabela "Tipo de
   saldo" (`segregation`) tem uma linha por evento; o filtro do painel mostra também fase, operação, exceção,
   informativo ou marcação, e "Remover filtro do painel" tira todos eles.
6. **Justificativas** — listas de exclusão e de alteração (tabelas `deletionJustifications` e
   `changeJustifications`, com valor do documento, valor excluído e histórico); editor (texto, responsável, copiar
   da outra lista, confirmar que abrange o novo evento); importar planilha exportada ou JSON com prévia, cobertura
   escolhível e conflitos lado a lado; exportar cópia em JSON; data da última cópia e aviso de alterações sem cópia;
   contagem de chaves sem documento no log atual; ajuda "Como funciona".
7. **Exportação** (`export`) — escopo, idioma (português/inglês), lista de verificações bloqueantes com caixa de
   confirmação (sem ela o botão não gera), progresso por etapa, download com `downloadBlob`, mensagem com nome e
   tamanho.
8. **Configuração** — uma aba por análise com regras salvas (abre na da ferramenta aberta; a da CT2 tem o quadro
   de testes com Ligado e Severidade, os parâmetros padrão e os códigos do Lcto Manual?), a cópia de segurança abaixo
   das abas. Em cada aba: seções do formulário, erros por campo (`readConfig`), importar/exportar JSON, restaurar
   padrão, diferenças em relação ao padrão e SHA-256, editor JSON avançado, salvar (`applyConfig` do App).
   Com análise na tela e configuração alterada (fora atalhos e feriados), aviso **"Reprocessar com esta
   configuração"**, que reaproveita os arquivos carregados. **Cópia de segurança**: baixar um arquivo com a
   configuração, os feriados da plataforma e as justificativas (`buildBackup`, versão 3, com a configuração de cada análise) e restaurar com confirmação
   (`readBackup`, que também lê as cópias da versão 1.0.0; `restoreBackup` do App), substituindo tudo. Os feriados
   valem para todas as análises.
9. **Tema** — claro (padrão) e escuro, trocados na barra lateral (`src/app/themeStore.ts`: `<html data-theme>`,
   preferência no IndexedDB). Cores só por tokens de `src/app/global.css`; os dois temas devem continuar legíveis.
   Animações apenas com `transform`/`opacity` e desligadas com `prefers-reduced-motion`.
10. **Geral** — "Nova análise", "Encerrar sessão" (termina o worker e limpa a tela), botão "Exportar planilha",
   aviso de configuração salva inválida, aviso de reprocessamento na tela principal, link **Ajuda** para
   `ajuda.html` (manual estático em `public/`, abre em nova aba, funciona offline), **versão** no rodapé
   (`APP_VERSION_LABEL`) e, abaixo dela, a linha de autoria "Desenvolvido por Carlos Danyell" (classe
   `.author`, no mesmo estilo da versão).

## Como validar

- `npm run test`, `npm run lint` e `npm run build` passando (há testes de tela em `tests/unit/App.test.tsx` e
  `tests/unit/ReconciliationView.test.tsx`; ajuste-os ao novo layout sem remover o que verificam).
- **`npm run test:e2e` passando** (Playwright, `tests/e2e/app.spec.ts`): é o critério de aceite da nova interface.
  Os testes acham os elementos pelo papel e pelo texto visível — botões "Analisar", "Cancelar", "Painel",
  "Nova análise", "Exportar planilha", "Gerar planilha", "Configuração", "Salvar configuração",
  "Reprocessar com esta configuração", "Baixar cópia de segurança", "Restaurar", "Exportar cópia em JSON",
  "Aplicar importação", "Ver no Consolidado (mesmo período)", "Ferramentas" (trilha), "Mudar para …", "Usar tema
  escuro"/"Usar tema claro", os cartões das ferramentas pelo título, link "Ajuda" e "Manual desta análise";
  opções (radio) "Geral" e "Segregado",
  tabela "Categorias por fase", região "Exceções da fase Postado (1)"; campos "Escopo", "Período",
  "Texto da justificativa", "Tolerância de balanceamento (R$)", "Arquivo da cópia de segurança"; e as mensagens
  citadas nos testes. Mudou um texto? Atualize o teste junto, sem tirar a verificação. Os nomes são procurados por
  trecho, sem diferenciar maiúsculas: um botão ou link novo não pode conter "Analisar", "Ajuda", "Configuração",
  "Painel", "Cancelar", "Nova análise" nem "Exportar planilha". `tests/e2e/modules.spec.ts` cobre o início, a trilha, a análise
  da CT2 em prévia e o aviso de arquivo trocado (botão "Mudar para …"). Cada teste também reprova
  qualquer requisição fora da origem do app (inclusive as bloqueadas pela CSP) e qualquer erro não tratado.
- Percorrer as telas com os dois arquivos grandes: a tela não pode travar durante leitura, navegação e exportação.
- Nenhum dado real, nome de empresa ou de pessoa em arquivos versionados.
