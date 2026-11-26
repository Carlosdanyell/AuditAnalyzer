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
  `config`, chaves `uiTheme` e `lastModule`, e a densidade das tabelas, chave `uiTableDensity`; as chaves da configuração estão em `docs/ARQUITETURA.md`, seção 6).
- Textos em português; fontes do próprio app (`src/assets/fonts`, SIL OFL): Sora nos títulos, Geist no texto e
  Geist Mono nos números e códigos, com `Aptos, "Segoe UI", system-ui` de reserva; nada é baixado de fora.
- Aviso permanente: "Os arquivos são processados neste computador e não são enviados para nenhum servidor."

## Telas e comportamentos obrigatórios

0. **Início da plataforma — Ferramentas** (`docs/MODULOS.md`, seção 4) — um cartão por ferramenta, lado a lado (um
   por linha em tela estreita): o ícone da ferramenta (traço branco sobre azul-marinho, com o ponto vermelho da marca),
   o código curto, as marcas de situação (discretas, contornadas), o título, a descrição (uma frase), dois ou três
   destaques curtos do que ela responde (`highlights` do descritor), o arquivo esperado numa linha compacta ("Lê …"),
   o link "Manual desta análise" e o botão visual "Abrir"; três cartões lado a lado em tela larga, um por linha a 390 px;
   cada ferramenta tem um acento discreto (faixa superior, código e tiques dos destaques) vindo do descritor (`accent`,
   cores `--tool-*`, nunca vermelho; padrão steel), sem comparar ids de módulo; o cartão inteiro
   é um botão com o título da ferramenta e abre o espaço de trabalho dela (a área de arquivos só existe ali). O
   cartão sobe levemente ao passar o mouse (sem movimento com `prefers-reduced-motion`); o da análise aberta tem a borda
   azul e a faixa superior vermelha (no lugar do acento). A última usada (`lastModule`,
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
   Ferramentas, a ferramenta aberta (código e situação) e só as visões que ela oferece — desde 25/11/2026 as mesmas nas
   três ferramentas: **Leitura, Visão geral, Análise, Justificativas** (só onde a ferramenta recebe justificativas: CFGR700
   e Conciliador) **e Exportação** (`features` do descritor; a Leitura é de todas) —, e no pé Configuração, Ajuda e
   Encerrar sessão; a visão na tela tem fundo claro e uma marca vermelha na borda (o vermelho só marca: visão ativa,
   verificações bloqueantes e achados). Topo com a trilha ("Ferramentas › ferramenta | arquivos") acima do título da
   tela e as ações à direita; a única ação primária é "Exportar planilha". Com a análise pronta, uma faixa de
   **indicadores-chave** logo abaixo do topo (`figuresOf` em `src/app/moduleViews.tsx`; CFGR700: linhas, documentos,
   partidas excluídas, alterações efetivas, desbalanceados e período, pelo escopo escolhido; CT2, sete: Lançamentos (linhas com valor),
   Documentos, Lotes, Desbalanceados (B1 ligado), Exceções (Erro e Alerta), Para conferência (ocorrências de I4a mais
   documentos mistos) e Período; todos seguem o escopo, não os filtros da barra). A faixa é o **único resumo** da análise:
   as visões não repetem os números dela (a Visão geral mostra a composição; os totais da seleção só sob filtro). Barra de status no pé: aviso de privacidade, versão,
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
   **Analisar** fica desabilitado e a dica aparece ao lado ("Monte ou importe o perfil de contas na Configuração"). Mensagens de
   erro com detalhe técnico recolhido.
2. **Processamento** — etapa atual, progresso por arquivo e total, linhas lidas, linhas/segundo, tempo decorrido e
   **Cancelar** (termina o worker e avisa que os dados lidos foram descartados).
3. **Leitura** (antes "Reconciliação") — por arquivo: SHA-256, integridade do ZIP, parâmetros, reconciliação de linhas,
   eventos por operação e verificações (bloqueantes e alertas); resumo da análise por escopo. **Com todas as
   verificações OK** (desde 25/11/2026), a tela é uma **linha verde** — "Integridade confirmada", "N/N verificações OK",
   o texto do módulo e "Ver detalhes" — que abre os detalhes (os números da leitura e tudo o que segue), recolhidos;
   **com falha ou alerta**, o veredito em cartão e os detalhes abertos (`RunStatus`, `src/components/ReconciliationParts.tsx`).
   Integridade da CT2: linhas após o cabeçalho − em branco = detalhe, valores ilegíveis por tipo com as primeiras linhas
   de origem, colunas encontradas, totais por tipo de saldo e moeda (sem somar segmentos) e as verificações CI-1, CI-2 e
   CI-4, e a **matriz de amarração**; o quadro de testes não fica mais aqui (é a lista da Análise). Desde 18/11/2026, o cartão
   **Plano de contas** (arquivo, formato, SHA-256, aba, linha do cabeçalho, contas, repetidas, com marcas diferentes,
   marcas desconhecidas, colunas ausentes e os avisos), ou a frase de que nenhum plano foi carregado (C1–C5 não
   aplicados); o formato de cada arquivo (`.xlsx`, XML, XML em `.zip`). Visões que o módulo não oferece não aparecem no
   menu.
4. **Visão geral** (antes "Painel"; comando `panel`) — escopo (cada arquivo e Consolidado); período por atalho (inclui os
   do usuário) ou datas, guardado na área de trabalho e o mesmo da Análise; data de corte editável; quadros: categorias
   por origem (cada número abre a tabela da Análise filtrada por categoria, período e origem; os antigos cartões de
   total por categoria saíram: repetiam a coluna "Total de documentos" e a faixa), período × demais dias × log
   completo, competência (com o indicador de fechamento), **orientação para registros sem documento** (`identification`: um arquivo → carregar a extração anterior; escopo de arquivo → "Ver no
   Consolidado" mantendo o período; demais → extração anterior ou CT2 pelo Recno; link para os registros),
   cobertura das justificativas (números abrem as listas), movimento diário; salvar atalhos e feriados. As
   **sinalizações** (Ação/Informativo/OK) são o filtro Teste da Análise (item 4a). Desde 26/11/2026, logo depois do
   período, o cartão **"Resultado da análise"** (região com esse nome; `ResultLevels`, `src/components/AnalysisResult.tsx`)
   — o mais importante primeiro: Alerta (sinalizações que exigem ação e exceções da fase Postado (1)) em coluna, cada
   item um botão "<nome>: <número com a unidade>" que abre a Análise com o teste escolhido (o número é o total da tabela);
   Informativo recolhido ("Informativo: N com ocorrência"); sinalização sem tabela só com o texto (ao passar o mouse).
   **Seletor Geral / Segregado** (grupo de opções "Análise"; padrão Geral, mantido ao abrir uma tabela e voltar). O modo
   Geral mostra o que mostrava antes (sem as sinalizações). O modo Segregado (`segregated`, seção 13 de REGRAS_CFGR700.md) mostra:
   categorias por fase com a
   linha de total igual ao modo Geral (cada número abre a tabela com a fase), eventos por fase e operação, segregação
   de funções, orientação para eventos Não determinados (extrair com "Exclui campos não alterados = Não" ou consultar a
   tabela pelo Recno) e o texto de limitações da seção 13. As exceções da fase Postado (1), os informativos e as
   marcações estão na lista da Análise.
   **Integridade da CT2** (`overview` e `tests`, `src/app/modules/ct2Integrity/Ct2OverviewView.tsx`) — tudo respeitando
   a barra de filtros (item 4b); débito e crédito nunca são somados entre segmentos. Desde 26/11/2026 os quadros seguem a
   **ordem de importância** e o tamanho acompanha a importância: (1) **"Resultado da análise"** (região com esse nome,
   o primeiro e maior): os desbalanceamentos em três números grandes — documentos (B1), lotes (B2) e dias (B3), em
   vermelho quando há ocorrência, cada um o botão "<código> <nome>: <número com a unidade>" —, depois os testes com
   ocorrência em colunas Erro, Alerta e Conferir com aprovação (com os documentos mistos) e o Informativo recolhido;
   cada número abre a Análise com o teste escolhido na tabela do nível do teste (Documentos, Lotes ou Dias; os de linha
   em Ocorrências; os mistos, Documentos com a origem Misto) e é o total dessa tabela (`ct2AnalysisResult`); (2)
   **"Intervenção manual"**: documentos por origem (botões "<Origem>: N documento(s)", que aplicam o filtro), o botão
   "Lotes com intervenção manual: N" e o % do débito em linhas manuais por segmento (com o débito manual e o total);
   (3) **"Valores por segmento"** (débito, crédito e débito em linhas manuais) com as **linhas de histórico** numa nota
   de rodapé ("N linha(s) de histórico (Cont.Hist) …", não mais um cartão); (4) os gráficos "Por rotina" e "Por dia",
   lado a lado em tela larga; (5) a tabela de lotes com intervenção manual e o perfil recolhido. **Só com filtro ativo**,
   uma linha "Na seleção" no topo: lançamentos e os botões "Documentos: N" e "Lotes: N" (sem filtro são os da faixa). Grupos de opções "Medida por
   rotina" (Linhas | Documentos | Débito) e "Medida por dia" (Linhas | Débito); a medida Débito fica desabilitada,
   com a explicação, com mais de um segmento e nenhum escolhido. Barras por rotina empilhadas por origem, cada uma um
   botão com nome "<rotina>: <n> linhas", "<rotina>: <n> documentos" ou "<rotina>: <valor> de débito" (clique = filtro
   Rotina), limitadas às maiores, com "Mostrar todas as N rotinas"; colunas por dia, cada uma um botão "dd/mm/aaaa: n
   linhas" (mais " (dia não útil)" quando for o caso; clique = filtro Dia). Tabela de lotes com intervenção manual, com
   "Filtrar o lote X/Y", "Abrir o 1º documento do lote X/Y" (painel lateral, item 4c) e "Ver os N na tabela de lotes".
   Perfil (por rotina, por lançamento padrão e por "Lcto Manual?") recolhido. Gráficos em SVG próprio, só com tokens,
   sem animar números, legíveis nos dois temas; o vermelho continua reservado a achados e à visão ativa.
4a. **Análise** (desde 25/11/2026; antes "Achados" e "Tabelas"; segunda revisão em 26/11/2026; `AnalysisLayout`,
   `src/components/AnalysisLayout.tsx`) — o lugar de trabalho, igual nas três ferramentas: **a tabela ocupa toda a
   largura do conteúdo e a altura que sobra na tela** (sem a coluna de testes à esquerda; no computador a página não
   rola — o shell marca a visão com `data-fill` e a tabela rola por dentro, com o cabeçalho fixo; abaixo de 1024 px de
   largura ou 560 px de altura a página rola e a tabela tem quase a altura da tela). Acima da tabela, no máximo duas
   linhas no computador: a **barra de filtros** (região "Filtros") e a linha das abas com os controles da tabela, "N
   linha(s)" e os de visualização; a regra do teste escolhido aparece entre as duas. Tabela mais estreita que a tela é
   alargada pela coluna de texto mais larga (`stretchColumns`); as fontes não mudam.
   O **teste é um filtro da barra**: o botão **"Teste"** (nome "Teste: todos os testes" ou "Teste: <código> <nome>:
   <número>"; `aria-haspopup="listbox"`, `aria-expanded`; mostra quantos testes têm ocorrência) abre a lista
   (`listbox` "Teste") com "Todos os testes" e os testes ou códigos de achado do módulo em grupos — **Erro**,
   **Alerta**, **Conferir com aprovação** (onde existe) e **Informativo**, cada grupo (`group`) com o seu nome —, cada
   opção "<código> <nome>: <número com a unidade>" (ex.: "B1 Documento desbalanceado: 6 documentos"); o número é o
   total da tabela que a escolha abre. Os sem ocorrência (e os desligados ou sem a coluna, com o motivo) ficam atrás de
   **"Mostrar sem ocorrência (N)"**, no grupo "Sem ocorrência", sem escolha. Teclado: setas, Home e End movem, Enter
   escolhe, Esc fecha e devolve o foco ao botão; clique fora fecha; no celular a lista sobe do pé da tela. Escolhido, o
   teste vira um **chip** como os outros filtros (botão "Remover filtro Teste") e a sua regra aparece numa linha abaixo
   da barra (nível e regra, com o botão "Tirar o filtro de teste"). O detalhe da linha abre **por cima** (item 4c). Nada
   do que se consultava saiu, só as duplicações: as "primeiras ocorrências" de cada teste são a tabela filtrada pelo
   teste; os documentos desbalanceados são Documentos com B1 (compensação na coluna B4); os maiores, Documentos ordenada
   por Linhas.
   - **CT2** (comando `tests`): barra = a barra de filtros comum (item 4b) com o filtro Teste depois de "Filtros", a
     busca e, no fim, o botão **"Parâmetros"** (`aria-expanded`), que abre sob a barra o painel "Parâmetros da execução"
     (título; "Reaplicar os testes", comando `analyze`, validados na tela antes de enviar; "Desfazer"; "Fechar os
     parâmetros"; Esc ou clique fora fecham sem perder o que foi digitado); grupos Erro e Alerta (as exceções),
     Conferir com aprovação (I4a e "Documentos mistos (linhas manuais e automáticas)", que abre Documentos com a origem
     Misto) e Informativo; P1 e P2 ficam no perfil da Visão geral. O teste abre a tabela aberta quando ela o lista
     (Documentos: testes de documento, P3 e P4; Lotes; Dias; Base: testes de linha) e **Ocorrências** nos demais casos;
     o número de cada item é o dessa tabela. Ao trocar de aba, o teste fica quando a nova tabela o lista. Abas:
     Ocorrências (a antiga Exceções, primeira), Documentos, Lotes, Dias e Base. A severidade vem da configuração: teste
     elevado a Erro ou Alerta passa a esse grupo.
   - **CFGR700:** barra = filtro Teste, o **período** como campos da barra (o mesmo da Visão geral: "Período", "De",
     "Até", numa linha), "Origem", o chip do filtro da Visão geral (escondido quando o chip do teste já o nomeia) e a
     busca; grupos Alerta (as
     sinalizações que exigem ação e as exceções da fase Postado (1)) e Informativo (as demais sinalizações com
     ocorrência, os informativos e as marcações da análise segregada), todos do período. "Documentos desbalanceados"
     abre Desbalanceados e "Registros alterados sem identificação de documento" a base de linhas não identificada, com
     exatamente aquelas linhas; as exceções, os informativos e as marcações abrem "Tipo de saldo" com o filtro; uma
     sinalização sem tabela (dias, inconsistências, sem usuário, justificativas pendentes), quando escolhida, mostra o
     seu texto na linha da regra e não filtra a tabela. Sem detalhe de linha.
   - **Conciliador:** barra = filtro Teste com os códigos de achado do resumo (Erro, Alerta, Informativo), cada um
     abrindo a tabela Achados com o código, o chip "Remover filtro da conciliação" e a busca; os códigos conhecidos sem
     ocorrência atrás de "Mostrar sem ocorrência". Com verificação bloqueante falhando, o aviso fica acima da barra. Abas
     Contas, Folha, Integração, Razão e Achados (abre em Achados).
4b. **Barra de filtros da CT2** (`Ct2FilterBar.tsx`; região "Filtros", no topo da Visão geral e no centro da Análise, com
   o estado em `Ct2Workspace`; desde 25/11/2026) — uma linha compacta: o botão **"Filtros"** (com o número de filtros ativos;
   `aria-expanded`), só na Análise o filtro **Teste** (item 4a), os chips dos filtros ativos (ou "Nenhum filtro: tudo o
   que foi lido."), "Limpar filtros" (tira os filtros comuns; o teste sai pelo seu chip) e, só na Análise, a busca da
   tabela (campo "Buscar", que fica ao trocar de tabela) e o botão "Parâmetros". O botão "Filtros" abre, abaixo da linha, o painel
   de filtros em três grupos: **Datas e segmento** (combobox "Segmento", só com mais de um segmento; "Período: de" e
   "até"; "Dia"), **Origem e rotina** (grupo "Origem do documento" com botões de alternância Automático, Manual, Misto
   e Não identificado, seleção múltipla; combobox "Rotina") e **Lote, conta e valor** ("Lote", "Sub-lote", "Conta
   (débito ou crédito)" com a caixa "Começa com", "Valor mínimo (R$)" e "Valor máximo (R$)"). Escolhas (segmento,
   datas, origem, rotina) valem na hora; os campos digitados valem com Enter ou **"Aplicar"** (valor em formato
   diferente de 1.234,56, ou mínimo maior que o máximo, mostra o erro com o nome do campo e nada muda). **Esc** fecha o painel (e "Fechar") e o foco
   volta ao botão "Filtros"; ao abrir, o foco vai ao primeiro campo. Cada filtro ativo é um chip com o botão "Remover
   filtro Segmento|Origem|Rotina|Lote|Dia|Período|Conta|Valor"; "Limpar filtros" tira todos. Clicar num número ou
   gráfico cria o filtro. Chip que não vale para a tabela aberta (origem, rotina, conta e valor em Lotes e Dias; lote
   em Dias) fica esmaecido, com a dica "não se aplica a esta tabela", e é ignorado nela. Semântica e aplicabilidade na
   seção 9 de `docs/REGRAS_CT2_INTEGRIDADE.md`: a linha passa quando seu bloco está no segmento, dia, período e lote, o
   documento tem origem escolhida e a rotina, a conta e o valor da linha são os escolhidos; documento, lote ou dia passa
   se ao menos uma de suas linhas passa. Todo número da Visão geral e do filtro Teste é igual ao total da tabela
   aberta com o mesmo filtro.
4c. **Detalhe da linha** (`DetailPane`, `src/components/DetailPane.tsx`; CT2: documento, `Ct2DocumentPanel.tsx`, comando
   `document`; Conciliador: conta, item 9a) — desde 26/11/2026, em **qualquer largura**, um painel lateral modal que
   entra pela direita **por cima** da tabela (cerca de 60% da largura, entre 560 e 1100 px; a tela inteira no celular),
   sobre um fundo escurecido; a tabela nunca muda de tamanho. Diálogo (`role="dialog"`, `aria-modal="true"`) com o foco
   no botão de fechar ao abrir e preso dentro; **Esc**, clique no fundo ou o botão de fechar fecham, e o foco volta a
   quem o abriu (a linha). Com `prefers-reduced-motion`, sem deslizar. Documento da CT2: nome "Documento <doc>
   · lote <lote>/<sub> · dd/mm/aaaa"; cabeçalho com chave, origem, rotinas, débito e crédito por segmento e situação de
   B1/B4; linhas com marca discreta (não vermelha) nas manuais, marca de achado e o motivo nas com exceção, e "Valor
   Moeda1" visível quando difere de "Valor". Botões "Ver na Base" (abre a Base da Análise filtrada pelo documento) e
   "Fechar o documento". Abre por clique ou Enter numa linha de Ocorrências, Documentos ou Base, e pelos botões da Visão
   geral (lotes com intervenção manual).
5. **Tabelas** (`page`; no centro da Análise desde 25/11/2026) — tabela, busca, ordenação, filtros vindos da Visão geral e do filtro Teste, paginação e rolagem virtualizada;
   colunas definidas pelo worker (tipos: texto, inteiro, dinheiro em centavos, data, data/hora). Desde 25/11/2026
   (`TablesView`, comum a todos os módulos; na Análise com `fill`, item 4a): cabeçalho fixo; números, valores e datas à direita em Geist Mono com
   algarismos tabulares; separadores leves e zebra discreta; uma linha de resumo acima da tabela com "N linha(s)" e,
   na CT2, os filtros em vigor ("filtrado por …", a busca); o grupo "Densidade das linhas" (Confortável | Compacta,
   lembrada no computador, chave `uiTableDensity`); o botão **"Colunas"** (lista para mostrar ou ocultar colunas na
   tela, nesta sessão; Esc fecha; a exportação não muda); texto longo (histórico) cortado, inteiro ao passar o mouse e
   com o foco na linha; estado vazio "Nenhuma linha com esses filtros." com a dica do módulo. A tabela "Tipo de
   saldo" (`segregation`) tem uma linha por evento; o filtro do painel mostra também fase, operação, exceção,
   informativo ou marcação, e "Remover filtro do painel" tira todos eles. Integridade da CT2: Ocorrências, Documentos
   (com "Origem do documento"), Lotes (com "Documentos manuais" e "Documentos mistos"), Dias e Base, todas com a barra
   de filtros (item 4b), o filtro Teste (item 4a) e, na Base, "Mostrar todas as colunas";
   sem o filtro de origem do CFGR700. Ocorrências: combobox "Grupo" (Exceção, Conferir com aprovação, Informativo) e
   colunas de contexto (contas, centros de custo, itens e classes mapeados, Valor, Valor Moeda1, Histórico, Rotina,
   Lcto Manual?, Motivo e Grupo). Chips "Lotes com intervenção manual" ("Remover filtro de intervenção manual") e
   "Linhas de um documento" ("Remover filtro de documento"). Uma linha de Ocorrências, Documentos ou Base abre o
   detalhe (item 4c) por clique ou Enter.
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
   **Conciliador** (chave `analyzerConfig:reconciliation`) tem o **editor do perfil Folha** (Fase 16,
   `src/app/views/PayrollProfileEditor.tsx`; passos puros em `src/app/payrollProfileDraft.ts`), para montar o perfil sem
   escrever JSON: seção "Contas do perfil (N)" com um cartão por conta (tick mark, conta, nome, modo, natureza e
   critério; contagem de problemas e avisos) e os botões "Editar"/"Fechar edição" (`aria-expanded`), "Duplicar" e
   "Remover", com os nomes acessíveis "Editar a conta <conta>", "Duplicar a conta <conta>", "Remover a conta <conta>"
   (conta sem código: "<n> (sem código)"); o formulário da conta (grupo "Dados da conta <conta>") tem "Código da conta",
   "Nome da conta", "Natureza", "Tick mark", "Modo da conta" e os campos do modo — verbas: tabela "Verbas da conta"
   (por linha, "Código da verba N", "Sinal da verba N" com "+ soma"/"− subtrai", "Coluna na folha da verba N" com
   P/D/B ou "— não conferir —", botão "Remover a verba N") e "Adicionar verba", e "Verbas da baixa do saldo anterior
   (opcional)"; líquido: "Verba do líquido"; provisão: "Relatório de provisão", "Coluna do relatório" (as colunas do
   relatório no perfil), "Verbas da provisão do mês", "Verbas da baixa por férias" (só férias) e "Verbas da baixa por
   rescisão" (listas uma por linha; códigos em maiúsculas ao digitar). "Modo da nova conta" e **Adicionar conta** (a
   conta nova abre com o foco no código; a primeira conta de provisão inclui os relatórios de provisão). Seções
   recolhidas, com "· N problema(s)" no título: "Folha (GPER040)" (nível do escopo, tipo de contrato, verba do líquido
   da folha), "Razão (CTBR400)" (tabela "Classes de lote": classe, nome, "Começo da chave do lote N" ou "Expressão
   regular do lote N", "Adicionar classe de lote"; "Verba no histórico"), "Relatórios de provisão (GPER070 e GPER090)"
   ("Incluir os relatórios de provisão"; "Marcador de estorno", "Texto de fim dos relatórios", as 8 colunas de cada
   relatório; "Retirar os relatórios de provisão" só sem conta de provisão), "Baixa do saldo anterior" (máximo de
   lançamentos pesquisados) e "Situações do papel de trabalho (opcional)". Cada mudança passa pelo mesmo schema: o erro
   aparece em vermelho sob o campo, o aviso em âmbar; o rodapé lista os problemas com o lugar em palavras ("Conta 2
   (…) › Verbas da conta › verba 1 › Código") e o caminho no arquivo, e "Salvar configuração" só habilita sem erro.
   Ficam também **Importar perfil (JSON)** (campo "Arquivo do perfil de contas (JSON)"; mesmo schema, erros em
   português por campo, nada muda se for inválido; o perfil importado substitui o anterior inteiro no rascunho),
   **Exportar perfil (JSON)** (`{ "schemaVersion": 1, "profile": "payroll", … }`, o perfil salvo) e **Baixar modelo
   do perfil** (`modelo-perfil-conciliador-folha.json`: exemplo sintético, uma conta de cada modo, com `"$comment"` em
   português, que importa sem problemas). Mostra a situação ("Perfil sem contas…" ou "Perfil com N conta(s).") com o
   SHA-256, as diferenças em relação ao padrão, os avisos do perfil (não impedem salvar), **Restaurar padrão** e
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
   `docs/REGRAS_CONCILIADOR.md`) — trilho com Leitura, Visão geral, Análise, Justificativas e Exportação (25/11/2026).
   Indicadores-chave (sete): Contas, Sem diferença, Com diferença, Erros de integração, Verbas sem integração (F1c),
   Linhas de integração conferidas e Competência. **Leitura** (com tudo OK, a linha verde e "Ver detalhes"): veredito, "Quadro de invariantes" (L, R e
   V, T, F2 e CC, cada código com OK/Falha/Alerta), as verificações, e os arquivos lado a lado — "Folha de pagamento
   (GPER040)" e "Razão analítico (CTBR400)" — com relatório e formato ("GPER040 · TXT do spool", "CTBR400 · XML
   (SpreadsheetML)"), SHA-256, codificação, linhas, blocos, funcionários, escopos, competência, intervalo, tipo de saldo,
   contas e parâmetros do razão e as invariantes de cada arquivo; depois o razão por conta (real + pré-lançamento) e os
   arquivos fora da análise (aviso, nunca bloqueio). **Visão geral**: tabela "Contas do perfil", uma linha por conta (tick
   mark, conta, nome, padrão, esperado, saldo real, saldo pré-lançamento quando houver, saldo contábil, diferença,
   situação sugerida, baixa do saldo anterior, achados); conta não analisada mostra o motivo. Cada número é um botão com o
   nome "<Esperado|Saldo real|Saldo em pré-lançamento|Saldo contábil|Diferença> da conta <conta>: <valor>", "Baixa do
   saldo anterior da conta …" e "Achados da conta …: N"; o número abre a tabela da Análise cuja soma é ele (a diferença
   abre o detalhe com a ponte); "Abrir a conta <conta>" abre o detalhe. Abaixo da tabela (26/11/2026), o quadro
   **"Achados por gravidade"** (região com esse nome): os códigos com ocorrência em colunas Erro e Alerta e o
   Informativo recolhido, cada um o botão "<código> <título>: N ocorrência(s)", que abre a Análise com o código no
   filtro Teste. Com verificação bloqueante falhando, a Visão geral
   e a Análise avisam no topo. **Análise** (item 4a): o filtro Teste com os códigos de achado em grupos Erro, Alerta e
   Informativo, cada um "<código> <título>: N ocorrência(s)" (ex.: "F1c Verba da folha sem integração na conta: 1
   ocorrência"), que abre a tabela Achados com o código; nenhum filtro
   por valor. Tabelas Contas, Folha, Integração, Razão e Achados (coluna "Baixa do saldo anterior?" com Sim/Não e "Tipo
   de saldo" no Razão); o filtro que abriu a tabela (além do código) vira um chip com o botão "Remover filtro da
   conciliação"; clicar numa linha de uma conta analisada abre o detalhe da conta, por cima da tabela. As
   ações de cada ocorrência que ficavam nos blocos de Achados estão no detalhe da conta, em cada achado: "Ver as N
   linhas no razão" e, no F1c, "Ver na tabela de integração". **Detalhe da conta**: diálogo "Conta <conta> · <nome>" (Esc fecha; item 4c), com o
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
  Os testes acham os elementos pelo papel e pelo texto visível — botões "Analisar", "Cancelar", os da trilha
  "Leitura", "Visão geral", "Análise", "Justificativas" e "Exportação", "Ver detalhes" (Leitura), "Nova análise", "Exportar planilha", "Gerar planilha", "Configuração", "Salvar configuração",
  "Reprocessar com esta configuração", "Baixar cópia de segurança", "Restaurar", "Exportar cópia em JSON",
  "Importar perfil (JSON)", "Exportar perfil (JSON)", "Baixar modelo do perfil", "Adicionar conta", "Editar a conta …",
  "Duplicar a conta …", "Remover a conta …", "Adicionar verba", "Adicionar classe de lote", "Voltar" (Configuração do
  Conciliador), grupo "Dados da conta …" e campos "Código da verba N", "Coluna na folha da verba N", "Classe do lote N",
  "Começo da chave do lote N", "Modo da nova conta",
  "Aplicar importação", "Ver no Consolidado (mesmo período)", "Ferramentas" (trilha), "Mudar para …", "Usar tema
  escuro"/"Usar tema claro", as linhas das ferramentas pelo título, link "Ajuda" e "Manual desta análise";
  opções (radio) "Geral" e "Segregado",
  tabela "Categorias por fase"; na Visão geral a região "Resultado da análise" com os botões "<nome>: <número>"; na
  Análise, o botão "Teste: …" (`aria-expanded`), a lista (`listbox`) "Teste" com os grupos "Erro", "Alerta",
  "Conferir com aprovação", "Informativo" e "Sem ocorrência", as opções "<código> <nome>: <número>" e "Todos os
  testes", o botão "Mostrar sem ocorrência (N)", os botões "Remover filtro Teste" e "Tirar o filtro de teste", a região
  "Filtros" (com o campo "Período" no CFGR700); campos "Escopo", "Período",
  "Texto da justificativa", "Tolerância de balanceamento (R$)", "Arquivo da cópia de segurança", "Arquivo do perfil de
  contas (JSON)"; a dica "Monte ou importe o perfil de contas na Configuração"; e as mensagens
  citadas nos testes. Mudou um texto? Atualize o teste junto, sem tirar a verificação. Os nomes são procurados por
  trecho, sem diferenciar maiúsculas: um botão ou link novo não pode conter "Analisar", "Ajuda", "Configuração",
  "Painel", "Cancelar", "Nova análise" nem "Exportar planilha" (o trilho não tem mais "Painel" desde 25/11/2026). `tests/e2e/modules.spec.ts` cobre o início, a trilha, a análise
  do Conciliador (Fase 15: títulos "Integridade confirmada", "Quadro de invariantes", "Folha de pagamento (GPER040)",
  "Razão analítico (CTBR400)"; tabela "Contas do perfil"; botões "Esperado da conta …", "Abrir a conta …", "Remover
  filtro da conciliação", "Copiar o texto do critério", região "Achados por gravidade" e o botão e a opção "F1c Verba da
  folha sem integração na conta: 1 ocorrência",
  "Ver na tabela de integração", "Salvar a justificativa da conta …"; diálogo "Conta …" com "A ponte fecha"; campos
  "Justificativa da conta …" e "Situação no papel de trabalho da conta …"; textos "Justificativa salva neste
  computador."; e a Exportação, cujo download tem o Resumo com "Confere" em toda conta no avaliador), a análise
  da CT2, a escolha da aba e o aviso de arquivo trocado (botão "Mudar para …"). Para a CT2 ele usa também: botões da
  trilha "Leitura", "Visão geral", "Análise" e "Exportação"; título "Matriz de amarração" (Leitura); abas
  "Ocorrências", "Documentos", "Lotes" e "Base"; opções do filtro Teste "B1 Documento desbalanceado: N documentos",
  "E4 …", "I4a …", "C1 …: 7 linhas" e "Documentos mistos …"; na Visão geral, a região "Resultado da análise" com o
  botão "B1 Documento desbalanceado: N documentos" e a nota "N linha(s) de histórico (Cont.Hist) …";
  região "Filtros" com o botão "Filtros" (abre o painel; aria-expanded), combobox "Segmento", campos "Conta (débito ou
  crédito)" e "Valor mínimo (R$)", botão "Aplicar", botões "Remover filtro Segmento|Rotina|Conta|Valor" e "Limpar
  filtros", a dica "não se aplica a esta tabela"; grupo "Medida por rotina" (botão "Débito"), barras "<rotina>: <n> linhas" e botões
  "Documentos: N" (só com filtro), "Lotes com intervenção manual: N"; título "Por rotina", botão "Parâmetros", título
  "Parâmetros da execução", botão "Reaplicar os testes", combobox "Grupo"; e, no detalhe, o diálogo "Documento …"
  (`aria-modal` "true" em qualquer largura; 800–1100 px de largura a 1440 px, a tela inteira a 390 px; a tabela não muda
  de tamanho; Esc, clique no fundo e "Fechar o documento" devolvem o foco à linha) e "Ver na Base". Esses nomes não mudam sem atualizar o teste. Cada teste também reprova
  qualquer requisição fora da origem do app (inclusive as bloqueadas pela CSP) e qualquer erro não tratado.
- Percorrer as telas com os dois arquivos grandes: a tela não pode travar durante leitura, navegação e exportação.
- Nenhum dado real, nome de empresa ou de pessoa em arquivos versionados.
