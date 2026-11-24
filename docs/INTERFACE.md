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
- Textos em português; fontes do próprio app (`src/assets/fonts`, SIL OFL): Sora nos títulos, Geist no texto e
  Geist Mono nos números e códigos, com `Aptos, "Segoe UI", system-ui` de reserva; nada é baixado de fora.
- Aviso permanente: "Os arquivos são processados neste computador e não são enviados para nenhum servidor."

## Telas e comportamentos obrigatórios

0. **Início da plataforma — Ferramentas** (`docs/MODULOS.md`, seção 4) — um cartão por ferramenta, lado a lado (um
   por linha em tela estreita): o ícone da ferramenta (traço branco sobre azul-marinho, com o ponto vermelho da marca),
   o código curto, as marcas de situação, o título, a descrição, dois ou três destaques do que ela responde (`highlights`
   do descritor), o arquivo esperado ("Lê …"), o link "Manual desta análise" e o botão visual "Abrir"; o cartão inteiro
   é um botão com o título da ferramenta e abre o espaço de trabalho dela (a área de arquivos só existe ali). O
   cartão sobe levemente ao passar o mouse (sem movimento com `prefers-reduced-motion`); o da análise aberta tem a borda
   azul e a faixa superior vermelha. A última usada (`lastModule`,
   gravada ao Analisar) tem a marca "Última usada"; a ferramenta com análise carregada tem "Análise aberta" e
   "Voltar à análise". Ferramenta "Em breve" não abre; em prévia tem o selo "Prévia" e o aviso do
   que já faz, no espaço de trabalho e na reconciliação. Voltar às Ferramentas mantém a análise; abrir outra
   ferramenta encerra a análise aberta (o worker guarda uma por vez). Desde a Fase 15 são três ferramentas: Log de
   auditoria (CFGR700), Integridade da CT2 e **Conciliador** (`CONC`, ícone de dois lados que se encontram), este em
   prévia. Arquivo que parece ser de outra ferramenta:
   aviso "Este arquivo parece ser … Trocar de análise?" com o botão "Mudar para …", que troca e mantém a lista; o aviso
   nunca impede de analisar. **"Nova análise"** (topo) mantém a ferramenta e os arquivos.
   **Marca:** a logo é o "tique de auditoria" (linhas do razão e o tique vermelho de item conferido): no trilho, sem o
   ladrilho, acima do nome; no favicon (`public/favicon.svg`), sobre o ladrilho azul-marinho. Vale para a plataforma
   inteira; uma ferramenta nova não traz marca própria.
   **Estrutura (console):** trilho azul-marinho estreito à esquerda, com ícone e rótulo curto em cada item:
   Ferramentas, a ferramenta aberta (código e situação) e só as visões que ela oferece (Reconciliação, Painel, Achados,
   Tabelas, Justificativas, Exportação; "Achados" é visão da plataforma, oferecida pelos módulos com o recurso
   `findings`: a CT2 e o Conciliador), e no pé Configuração, Ajuda e
   Encerrar sessão; a visão na tela tem fundo claro e uma marca vermelha na borda (o vermelho só marca: visão ativa,
   verificações bloqueantes e achados). Topo com a trilha ("Ferramentas › ferramenta | arquivos") acima do título da
   tela e as ações à direita; a única ação primária é "Exportar planilha". Com a análise pronta, uma faixa de
   **indicadores-chave** logo abaixo do topo (`figuresOf` em `src/app/moduleViews.tsx`; CFGR700: linhas, documentos,
   partidas excluídas, alterações efetivas, desbalanceados e período, pelo escopo escolhido; CT2, sete: Lançamentos (linhas com valor),
   Documentos, Lotes, Desbalanceados (B1 ligado), Exceções (Erro e Alerta), Para conferência (ocorrências de I4a mais
   documentos mistos) e Período; todos seguem o escopo, não os filtros da barra). Barra de status no pé: aviso de privacidade, versão,
   autoria e o botão de tema.
   **Densidade e movimento:** o que pede atenção fica aberto (falhas, alertas, sinalizações que exigem ação); o que
   está OK fica recolhido numa linha ("N verificação(ões) OK", "N sinalização(ões) sem ocorrência"); quadros de
   consulta do painel ficam recolhidos, com o status no título. Superfícies planas, com borda fina e cantos de 4–6 px;
   sem sombras, sem ícone em "ladrilho" colorido, sem rótulos em caixa alta. Animações só de `transform`/`opacity`,
   curtas (entradas ≈ 160 ms, só opacidade e sem cascata), e só onde dão retorno (progresso, conclusão, abrir/fechar, arrastar); nada contínuo
   decorativo; números nunca são animados (um valor de auditoria não mostra quantias intermediárias); respeitar
   `prefers-reduced-motion`.
1. **Arquivos** — soltar ou escolher um ou mais `.xlsx` (ou as extensões da ferramenta; o **Conciliador** aceita
   qualquer arquivo, sem filtro de extensão, e mostra a dica "TXT do spool, PDF, XML ou XLSX exportados do Protheus":
   o spool vem como `.##r`/`.__r` e o arquivo é reconhecido pelo conteúdo); a ordem define a ordem das fontes; remover arquivo; arquivo
   com mais de uma aba ganha o seletor **"Aba de <arquivo>"** ("Automática", o padrão, ou uma aba, lida pela sondagem
   do início); se mais de uma aba parece ser da análise na escolha automática, a linha avisa "Mais de uma aba parece
   ser desta análise (…). Escolha a aba a analisar." e **Analisar** espera a escolha;
   Analisar (envia a configuração do módulo: a salva, ou o padrão do módulo sem configuração editável). Quando a
   ferramenta ainda precisa de algo da sua configuração (`notReady` do descritor; Conciliador: perfil sem contas),
   **Analisar** fica desabilitado e a dica aparece ao lado ("Importe o perfil de contas na Configuração"). Mensagens de
   erro com detalhe técnico recolhido.
2. **Processamento** — etapa atual, progresso por arquivo e total, linhas lidas, linhas/segundo, tempo decorrido e
   **Cancelar** (termina o worker e avisa que os dados lidos foram descartados).
3. **Reconciliação** — por arquivo: SHA-256, integridade do ZIP, parâmetros, reconciliação de linhas, eventos por
   operação e verificações (bloqueantes e alertas); resumo da análise por escopo. Integridade da CT2: linhas após o
   cabeçalho − em branco = detalhe, valores ilegíveis por tipo com as primeiras linhas de origem, colunas encontradas,
   totais por tipo de saldo e moeda (sem somar segmentos) e as verificações CI-1, CI-2 e CI-4, e a **matriz de amarração** (que antes ficava no fim do Painel). Desde 18/11/2026, o cartão
   **Plano de contas** (arquivo, formato, SHA-256, aba, linha do cabeçalho, contas, repetidas, com marcas diferentes,
   marcas desconhecidas, colunas ausentes e os avisos), ou a frase de que nenhum plano foi carregado (C1–C5 não
   aplicados); o formato de cada arquivo (`.xlsx`, XML, XML em `.zip`). Visões que o módulo não oferece não aparecem no
   menu.
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
   **Integridade da CT2** (`overview`, `src/app/modules/ct2Integrity/Ct2OverviewView.tsx`) — composição da extração,
   tudo respeitando a barra de filtros (item 4b); débito e crédito nunca são somados entre segmentos. Indicadores
   (cada número abre a tabela correspondente ou aplica o filtro): botões "Documentos: N", "Lotes: N" e "Lotes com
   intervenção manual: N", lançamentos e linhas de continuação de histórico, débito total e % do débito em linhas
   manuais (por segmento) e documentos por origem, com botões "<Origem>: N documento(s)". Grupos de opções "Medida por
   rotina" (Linhas | Documentos | Débito) e "Medida por dia" (Linhas | Débito); a medida Débito fica desabilitada,
   com a explicação, com mais de um segmento e nenhum escolhido. Barras por rotina empilhadas por origem, cada uma um
   botão com nome "<rotina>: <n> linhas", "<rotina>: <n> documentos" ou "<rotina>: <valor> de débito" (clique = filtro
   Rotina), limitadas às maiores, com "Mostrar todas as N rotinas"; colunas por dia, cada uma um botão "dd/mm/aaaa: n
   linhas" (mais " (dia não útil)" quando for o caso; clique = filtro Dia). Tabela de lotes com intervenção manual, com
   "Filtrar o lote X/Y", "Abrir o 1º documento do lote X/Y" (painel lateral, item 4c) e "Ver os N na tabela de lotes".
   Perfil (por rotina, por lançamento padrão e por "Lcto Manual?") recolhido. Gráficos em SVG próprio, só com tokens,
   sem animar números, legíveis nos dois temas; o vermelho continua reservado a achados e à visão ativa.
4a. **Achados** (`findings`, `Ct2FindingsView.tsx`; "o que verificar", separado do Painel) — "Parâmetros da execução"
   recolhidos, com "Reaplicar os testes" (comando `analyze`, sem reler os arquivos; validados na tela antes de enviar).
   Cartões, na ordem: "Exceções — Erro e Alerta · N ocorrências" e "Conferir com documento de aprovação · N
   ocorrências e M documentos mistos", abertos; "Informativos · N ocorrências em T testes" e "N teste(s) sem
   ocorrência", recolhidos. Um bloco (`article`) por teste, com as primeiras ocorrências e o motivo de cada uma, o
   botão "Ver todas as ocorrências de <código>" (abre Tabelas › Exceções com o teste) e, no grupo de aprovação, o
   botão "Documentos mistos: N" e a lista deles. Cada ocorrência com documento tem o botão "Abrir o documento <doc> do
   lote <lote>" (painel lateral). Depois, documentos desbalanceados (com a compensação) e os maiores documentos. A
   severidade vem da configuração: teste elevado a Erro ou Alerta passa ao grupo de exceções.
4b. **Barra de filtros da CT2** (`Ct2FilterBar.tsx`; região "Filtros", fixa em Painel, Achados e Tabelas, com o estado
   em `Ct2Workspace`) — combobox "Segmento" (só com mais de um segmento), grupo "Origem do documento" com botões de
   alternância Automático, Manual, Misto e Não identificado (seleção múltipla), combobox "Rotina", campos "Lote" e
   "Sub-lote" com o botão "Filtrar o lote" e campo "Dia". Cada filtro ativo é um chip com o botão "Remover filtro
   Segmento|Origem|Rotina|Lote|Dia"; "Limpar filtros" tira todos. Clicar num número ou gráfico cria o filtro. Chip que
   não vale para a tabela aberta (origem e rotina em Lotes e Dias; lote em Dias) fica esmaecido, com a dica "não se
   aplica a esta tabela", e é ignorado nela. Semântica: a linha passa quando seu bloco está no segmento, dia e lote, o
   documento tem origem escolhida e a rotina da linha é a escolhida; documento, lote ou dia passa se ao menos uma de
   suas linhas passa. Todo número do Painel e de Achados é igual ao total da tabela aberta com o mesmo filtro.
4c. **Painel lateral do documento** (`Ct2DocumentPanel.tsx`; comando `document`) — diálogo (`role="dialog"`) com o
   nome "Documento <doc> · lote <lote>/<sub> · dd/mm/aaaa", foco preso, **Esc** fecha e o foco volta a quem o abriu.
   Cabeçalho com chave, origem, rotinas, débito e crédito por segmento e situação de B1/B4; linhas com marca discreta
   (não vermelha) nas manuais, marca de achado e o motivo nas com exceção, e "Valor Moeda1" visível quando difere de
   "Valor". Botões "Ver na Base" (abre Tabelas › Base filtrada pelo documento) e "Fechar o documento". Abre por
   clique ou Enter numa linha de Documentos, Exceções ou Base, e pelos botões de Painel e Achados.
5. **Tabelas** (`page`) — tabela, busca, ordenação, filtros vindos do painel, paginação e rolagem virtualizada;
   colunas definidas pelo worker (tipos: texto, inteiro, dinheiro em centavos, data, data/hora). A tabela "Tipo de
   saldo" (`segregation`) tem uma linha por evento; o filtro do painel mostra também fase, operação, exceção,
   informativo ou marcação, e "Remover filtro do painel" tira todos eles. Integridade da CT2: Documentos (com "Origem
   do documento"), Lotes (com "Documentos manuais" e "Documentos mistos"), Dias, Exceções e Base, todas com a barra
   de filtros (item 4b), o teste vindo de Achados ("Remover filtro do painel") e, na Base, "Mostrar todas as colunas";
   sem o filtro de origem do CFGR700. Exceções: combobox "Grupo" (Exceção, Conferir com aprovação, Informativo) e
   colunas de contexto (contas, centros de custo, itens e classes mapeados, Valor, Valor Moeda1, Histórico, Rotina,
   Lcto Manual?, Motivo e Grupo). Chips "Lotes com intervenção manual" ("Remover filtro de intervenção manual") e
   "Linhas de um documento" ("Remover filtro de documento"). Uma linha de Documentos, Exceções ou Base abre o painel
   lateral (item 4c) por clique ou Enter.
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
   padrão, diferenças em relação ao padrão e SHA-256, editor JSON avançado, salvar (`applyConfig` do App). A aba do
   **Conciliador** (chave `analyzerConfig:reconciliation`) não tem formulário nem editor JSON: o perfil Folha é
   importado e exportado inteiro, como arquivo, por **Importar perfil (JSON)** (campo "Arquivo do perfil de contas
   (JSON)"; o arquivo passa pelo mesmo schema, com os erros em português por campo, e nada muda se for inválido) e
   **Exportar perfil (JSON)** (`{ "schemaVersion": 1, "profile": "payroll", … }`, o perfil salvo); o perfil importado
   substitui o anterior inteiro no rascunho e vale depois de **Salvar configuração**. Mostra a situação ("Perfil sem
   contas…" ou "Perfil com N conta(s).") com o SHA-256, as diferenças em relação ao padrão, os avisos do perfil (não
   impedem salvar), a tabela das contas (tick mark, conta, padrão, natureza, critério), **Restaurar padrão** e
   **Voltar**.
   Com análise na tela e configuração alterada (fora atalhos e feriados), aviso **"Reprocessar com esta
   configuração"**, que reaproveita os arquivos carregados. **Cópia de segurança**: baixar um arquivo com a
   configuração, os feriados da plataforma e as justificativas (`buildBackup`, versão 3, com a configuração de cada análise) e restaurar com confirmação
   (`readBackup`, que também lê as cópias da versão 1.0.0; `restoreBackup` do App), substituindo tudo. Os feriados
   valem para todas as análises.
9. **Tema** — claro (padrão) e escuro, trocados na barra de status (`src/app/themeStore.ts`: `<html data-theme>`,
   preferência no IndexedDB). Cores só por tokens de `src/app/global.css`; os dois temas devem continuar legíveis.
   Animações apenas com `transform`/`opacity` e desligadas com `prefers-reduced-motion`.
9a. **Conciliador** (Fase 15, etapa 5; `src/app/modules/reconciliation/`, regras na seção 9 de
   `docs/REGRAS_CONCILIADOR.md`) — trilho com Reconciliação, Painel, Achados, Tabelas, Justificativas e Exportação.
   Indicadores-chave (sete): Contas, Sem diferença, Com diferença, Erros de integração, Verbas sem integração (F1c),
   Linhas de integração conferidas e Competência. **Reconciliação de leitura**: veredito, "Quadro de invariantes" (L, R e
   V, T, F2 e CC, cada código com OK/Falha/Alerta), as verificações, e os arquivos lado a lado — "Folha de pagamento
   (GPER040)" e "Razão analítico (CTBR400)" — com relatório e formato ("GPER040 · TXT do spool", "CTBR400 · XML
   (SpreadsheetML)"), SHA-256, codificação, linhas, blocos, funcionários, escopos, competência, intervalo, tipo de saldo,
   contas e parâmetros do razão e as invariantes de cada arquivo; depois o razão por conta (real + pré-lançamento) e os
   arquivos fora da análise (aviso, nunca bloqueio). **Painel**: tabela "Contas do perfil", uma linha por conta (tick
   mark, conta, nome, padrão, esperado, saldo real, saldo pré-lançamento quando houver, saldo contábil, diferença,
   situação sugerida, baixa do saldo anterior, achados); conta não analisada mostra o motivo. Cada número é um botão com o
   nome "<Esperado|Saldo real|Saldo em pré-lançamento|Saldo contábil|Diferença> da conta <conta>: <valor>", "Baixa do
   saldo anterior da conta …" e "Achados da conta …: N"; o número abre a tabela cuja soma é ele (a diferença abre o painel
   lateral com a ponte); "Abrir a conta <conta>" abre o painel lateral. Com verificação bloqueante falhando, Painel e
   Achados avisam no topo. **Achados**: cartões "Erro · N ocorrência(s)" e "Alerta · …" abertos, "Informativo · …"
   recolhido; um bloco (`article`) por código com o nome "<código> <título>" (ex.: "F1c Verba da folha sem integração na
   conta"), o botão "Ver todas as ocorrências de <código>" e, por ocorrência, a conta ("Abrir a conta …"), "Ver as N
   linhas no razão" e, no F1c, "Ver na tabela de integração"; nenhum filtro por valor. **Tabelas**: Contas, Folha,
   Integração, Razão e Achados (coluna "Baixa do saldo anterior?" com Sim/Não e "Tipo de saldo" no Razão); o filtro que
   abriu a tabela vira um chip com o botão "Remover filtro da conciliação"; clicar numa linha de uma conta analisada abre
   o painel lateral. **Painel lateral da conta**: diálogo "Conta <conta> · <nome>" (foco preso, Esc fecha), com o
   critério (verbas, colunas, sinais, esperado), a ponte ("A ponte fecha"/"A ponte não fecha", cada parcela recolhida
   com os seus lançamentos), "Baixa do saldo anterior (F3): <situação>" com os lançamentos, os achados da conta, o "Texto
   do critério" com o botão "Copiar o texto do critério", "Ver no Razão" e "Fechar os detalhes da conta".
   **Justificativas**: um cartão por conta com o campo "Justificativa da conta <conta>", a lista "Situação no papel de
   trabalho da conta <conta>" (só com `workpaperStatuses` no perfil; começa em "— não escolhida —") e, ao lado, só para
   leitura, a "Situação sugerida pelo módulo"; botão "Salvar a justificativa da conta <conta>" e a mensagem
   "Justificativa salva neste computador." (IndexedDB, chave `reconciliationJustifications`). **Exportação**: a visão
   comum (idioma, confirmação das verificações bloqueantes, "Gerar planilha") com as abas do Conciliador e o número de
   contas com justificativa na competência (link "Escrever justificativas" quando não há nenhuma); as justificativas da
   competência vão para o Resumo da planilha (Fase 15, etapa 6).
10. **Geral** — "Nova análise", "Encerrar sessão" (termina o worker e limpa a tela), botão "Exportar planilha",
   aviso de configuração salva inválida, aviso de reprocessamento na tela principal, link **Ajuda** para
   `ajuda.html` (manual estático em `public/`, abre em nova aba, funciona offline), **versão** na barra de status
   (`APP_VERSION_LABEL`) e, ao lado dela, a linha de autoria "Desenvolvido por Carlos Danyell", no mesmo estilo.

## Como validar

- `npm run test`, `npm run lint` e `npm run build` passando (há testes de tela em `tests/unit/App.test.tsx` e
  `tests/unit/ReconciliationView.test.tsx`; ajuste-os ao novo layout sem remover o que verificam).
- **`npm run test:e2e` passando** (Playwright, `tests/e2e/app.spec.ts`): é o critério de aceite da nova interface.
  Os testes acham os elementos pelo papel e pelo texto visível — botões "Analisar", "Cancelar", "Painel",
  "Nova análise", "Exportar planilha", "Gerar planilha", "Configuração", "Salvar configuração",
  "Reprocessar com esta configuração", "Baixar cópia de segurança", "Restaurar", "Exportar cópia em JSON",
  "Importar perfil (JSON)", "Exportar perfil (JSON)", "Voltar" (Configuração do Conciliador),
  "Aplicar importação", "Ver no Consolidado (mesmo período)", "Ferramentas" (trilha), "Mudar para …", "Usar tema
  escuro"/"Usar tema claro", as linhas das ferramentas pelo título, link "Ajuda" e "Manual desta análise";
  opções (radio) "Geral" e "Segregado",
  tabela "Categorias por fase", região "Exceções da fase Postado (1)"; campos "Escopo", "Período",
  "Texto da justificativa", "Tolerância de balanceamento (R$)", "Arquivo da cópia de segurança", "Arquivo do perfil de
  contas (JSON)"; a dica "Importe o perfil de contas na Configuração"; e as mensagens
  citadas nos testes. Mudou um texto? Atualize o teste junto, sem tirar a verificação. Os nomes são procurados por
  trecho, sem diferenciar maiúsculas: um botão ou link novo não pode conter "Analisar", "Ajuda", "Configuração",
  "Painel", "Cancelar", "Nova análise" nem "Exportar planilha". `tests/e2e/modules.spec.ts` cobre o início, a trilha, a análise
  do Conciliador (Fase 15: títulos "Integridade confirmada", "Quadro de invariantes", "Folha de pagamento (GPER040)",
  "Razão analítico (CTBR400)"; tabela "Contas do perfil"; botões "Esperado da conta …", "Abrir a conta …", "Remover
  filtro da conciliação", "Copiar o texto do critério", "Ver todas as ocorrências de F1c", "Salvar a justificativa da
  conta …"; diálogo "Conta …" com "A ponte fecha"; bloco "F1c Verba da folha sem integração na conta"; campos
  "Justificativa da conta …" e "Situação no papel de trabalho da conta …"; textos "Justificativa salva neste
  computador."; e a Exportação, cujo download tem o Resumo com "Confere" em toda conta no avaliador), a análise
  da CT2, a escolha da aba e o aviso de arquivo trocado (botão "Mudar para …"). Para a CT2 ele usa também: botões da
  trilha "Reconciliação", "Painel", "Achados", "Tabelas" e "Exportação"; título "Matriz de amarração" (Reconciliação);
  região "Filtros", combobox "Segmento", botões "Remover filtro Segmento|Rotina" e "Limpar filtros", a dica "não se
  aplica a esta tabela"; grupo "Medida por rotina" (botão "Débito"), barras "<rotina>: <n> linhas" e botões
  "Documentos: N", "Lotes com intervenção manual: N"; títulos "Por rotina" e "Exceções — Erro e Alerta", botões "B1: N
  documentos", "Reaplicar os testes" e "Remover filtro do painel"; e, no painel lateral, o diálogo "Documento …", "Ver
  na Base" e "Fechar o documento". Esses nomes não mudam sem atualizar o teste. Cada teste também reprova
  qualquer requisição fora da origem do app (inclusive as bloqueadas pela CSP) e qualquer erro não tratado.
- Percorrer as telas com os dois arquivos grandes: a tela não pode travar durante leitura, navegação e exportação.
- Nenhum dado real, nome de empresa ou de pessoa em arquivos versionados.
