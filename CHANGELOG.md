# Histórico de versões

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); as versões seguem SemVer.

## [Não publicado]

### Integridade da CT2: planilha amarrada por fórmulas (Fase 11, docs/REGRAS_CT2_INTEGRIDADE.md, seção 7)
- Exportação disponível na prévia, em português e inglês: Resumo (indicadores por tipo de saldo e moeda, matriz de
  amarração, quadro de testes, documentos desbalanceados, conclusão automática), Criterios (parâmetros editáveis como
  nomes definidos), Documentos, Lotes e Dias somados por bloco, Excecoes confirmadas na origem, Perfil, Base com as
  colunas de teste e Rastreabilidade.
- Mudar um parâmetro na planilha (tolerância, período, tipo de saldo, moeda, limite de linhas) recalcula testes e
  status como a ferramenta.
- Exceções acima do limite de linhas do Excel continuam em outra aba; Base acima do limite bloqueia a exportação.
- Nome do arquivo com o primeiro e o último mês quando a extração tem mais de um mês.

### Integridade da CT2: motor e quadro de testes, em prévia (Fase 10, docs/REGRAS_CT2_INTEGRIDADE.md)
- Aglutinação por documento, lote e dia dentro de cada tipo de saldo e moeda, em centavos, e os testes de
  balanceamento (B1–B5, com a compensação pelo documento vizinho), de consistência da linha (I1–I5), de estrutura
  (E1–E6) e de perfil (P1–P4).
- Quadro de testes na reconciliação: ocorrências de cada teste e resultado de B4, P1–P4; testes sem ocorrência
  recolhidos.
- Novas verificações: débito e crédito iguais em todos os níveis (CI-3), exceções conferidas com as marcas (CI-5) e
  contagens de documentos, lotes e dias (CI-6), bloqueantes; colunas opcionais (CI-9) e período (CI-10), alertas.
- Configuração da CT2 editável e salva neste computador: cada teste ligado ou desligado com a severidade, parâmetros
  padrão e códigos do Lcto Manual?; aba por análise na tela Configuração.
- Cópia de segurança versão 3, com a configuração da CT2; as versões anteriores continuam sendo restauradas.
- Extrações com mais de um mês: o período da análise cobre todos os meses lidos e aparece na tela, com a quantidade
  de meses.

### Interface: plataforma de ferramentas, menos ruído
- Início com um cartão por ferramenta; a ferramenta abre o próprio espaço de trabalho. A análise continua aberta ao
  voltar às Ferramentas e termina ao abrir outra ferramenta (substitui "Trocar análise").
- Barra lateral enxuta (só as visões da ferramenta aberta, tema como ícone) e topo com trilha e título numa linha.
- Verificações e sinalizações OK recolhidas; quadros de consulta do painel recolhidos com o status no título.
- Visual neutro (sem gradientes e brilhos) e animações curtas só onde dão retorno; números do painel não são mais
  animados.

### Integridade da CT2: leitura, em prévia (Fase 9, docs/REGRAS_CT2_INTEGRIDADE.md)
- Nova análise disponível como **prévia**: lê uma ou mais extrações da tabela CT2 (cabeçalho localizado pelos títulos
  nas primeiras 30 linhas, aliases `CT2_*`, códigos como texto, valores em centavos, datas do Excel ou `dd/mm/aaaa`),
  confere SHA-256, CRC32 e tamanho, reconcilia as linhas de cada arquivo e mostra linhas, documentos, lotes, dias e
  débito e crédito por tipo de saldo e moeda.
- Verificações bloqueantes: linhas da extração conferidas (CI-1), base em blocos contíguos (CI-2) e valores legíveis
  (CI-4, com as primeiras linhas com problema de cada arquivo). Painel, tabelas e exportação chegam na Fase 10.
- Aviso na tela inicial quando um arquivo parece ser de outra análise, com a troca mantendo a lista de arquivos.
- Leitura de extrações largas: colunas em blocos fixos e compactadas (textos quase todos distintos guardados como
  bytes), strings compartilhadas decodificadas item a item e atalho do parser para a célula usual (o CFGR700 também
  usa o atalho, com saídas idênticas). 1,3 milhão de linhas sintéticas em ~56 s, pico de 220 MB.
- Ajuda: seção da Integridade da CT2.

### Plataforma de módulos (Fase 8, docs/MODULOS.md)
- Tela inicial com o seletor de análises: Log de auditoria (CFGR700), marcado por padrão, e Integridade da CT2
  ("Em breve"). A última análise usada volta marcada; o nome da análise aparece no topo; **Trocar análise** encerra a
  sessão e volta ao seletor (**Nova análise** continua mantendo os arquivos).
- Processamento: o comando `ingest` informa a análise; o worker despacha para o módulo por um registro, com uma
  sessão nova por ingestão. O CFGR700 roda pelo mesmo motor, sem mudança de resultado, painel ou planilha.
- Configuração por análise no IndexedDB (`analyzerConfig:cfgr700`), migrada da chave da versão 1.0.0 sem perda; a
  chave antiga continua gravada como espelho. Os feriados passam a valer para todas as análises (`platformConfig`),
  com o mesmo hash de configuração na Rastreabilidade.
- Cópia de segurança versão 2, com os feriados da plataforma; as cópias feitas pela versão 1.0.0 continuam sendo
  restauradas.
- Ajuda: seção "Escolher a análise"; o manual do CFGR700 agrupado sob a âncora `#cfgr700`.
- Especificação do módulo Integridade da CT2 (`docs/REGRAS_CT2_INTEGRIDADE.md`) com as decisões do usuário sobre o
  limite de linhas por documento (`MV_NUMLIN`), "Lcto Manual?", usuário em "Origem" e a separação da análise por tipo
  de saldo e moeda.

### Análise segregada por tipo de saldo (seção 13 de REGRAS_CFGR700.md)
- Especificação: nova seção 13 e decisões registradas; invariantes 12 a 15 na seção 11.
- Motor: tipo de saldo (CT2_TPSALD) no momento de cada evento, com a fonte (Direta, Reconstruída, Não determinado),
  reconstruído sempre sobre a base consolidada; fases Pré-lançamento (9), Efetivação, Postado (1), Outro tipo de saldo
  e Não determinado; exceções da fase Postado (1), reabertura e eventos após reabertura, marcações "Efetivação com
  alteração de conteúdo" e "Ordem no mesmo segundo"; segregação de funções por documento. O modo Geral não muda.
- Verificações: soma das fases, fase Efetivação com `9 → 1` e tipo de saldo não presumido (bloqueantes); exceções da
  fase Postado (1) (alerta).
- Painel: seletor Geral / Segregado; categorias por fase com total igual ao modo Geral, eventos por fase e operação,
  exceções em destaque, segregação de funções, orientação para eventos não determinados e limitações. Nova tabela
  "Tipo de saldo" (uma linha por evento) e filtro por fase nas tabelas abertas pelo painel.
- Planilha: aba Segregacao, quadro "8. Análise por tipo de saldo" no Resumo (fórmulas), colunas de segregação de
  funções e colunas auxiliares "Fase" e "Exceção em saldo 1?" em Documentos e Base_Linhas, regras e limitações na aba
  de critérios (português e inglês).
- Importação de justificativas lê só as abas que usa.
- Rodapé: linha de autoria abaixo da versão.
- Verificações da reconciliação com nomes e mensagens em linguagem direta: o que foi conferido, o que foi encontrado e,
  quando houver problema, onde ver e o que fazer. Regras, níveis e resultados não mudam.
- Testes: casos sintéticos da seção 13, regressão do modo Geral contra o registro anterior à mudança e teste de ponta
  a ponta do seletor.

## [1.0.0] — 2026-09-27

Primeira versão para uso da contabilidade.

### Leitura (Fase 1)
- Leitura em fluxo do `.xlsx` do CFGR700 (ZIP com acesso aleatório, descompressão nativa, XML em partes) e
  armazenamento colunar; SHA-256 de cada arquivo, CRC32 e tamanho de cada parte, reconciliação das linhas do relatório.

### Motor (Fase 2)
- Eventos, estado final de cada registro, critério de corte das alterações (efetivação 9 → 1 e carimbo de usuário
  descartados), documentos, balanceamento, base parcial e invariantes, para cada arquivo e no consolidado.

### Painel e tabelas (Fase 3)
- Painel por período (atalhos, datas livres, atalhos próprios), data de corte, competência, sinalizações, feriados e
  movimento diário; tabelas virtualizadas com busca, ordenação e filtros vindos do painel.

### Justificativas (Fase 4)
- Uma justificativa por documento e tipo, com cobertura (arquivos e último evento) e situação; importação de planilha
  anterior ou JSON, conflitos lado a lado, cópia em JSON.

### Planilha (Fase 5)
- Papel de trabalho em Excel (português ou inglês) com Resumo por fórmulas, justificativas editáveis, dados,
  critérios e rastreabilidade; valores codificados legíveis, identificação das justificativas pelo valor e histórico,
  padrão visual da equipe; orientação no painel para alterados sem documento.

### Configuração (Fase 6)
- Tela de configuração da CT2 com validação por campo, importar/exportar JSON, restaurar padrão, versão 2 do
  esquema com migração e diferenças em relação ao padrão na rastreabilidade.

### Nova interface
- Layout com barra lateral (sessão, visões, configuração, ajuda, tema) e barra superior fixa com escopo e ações.
- Tema claro (padrão) e escuro, com troca animada; preferência salva no IndexedDB.
- Tela inicial com área de envio, ordem dos arquivos ajustável (subir/descer) e guia do fluxo.
- Processamento com percentual geral, linha do tempo das etapas e situação de cada arquivo.
- Reconciliação com veredito de integridade, indicadores e verificações com falhas e alertas primeiro.
- Painel com indicadores por categoria (divisão manual/automático/misto), gráfico diário empilhado com dica e
  tabela alternativa, cobertura das justificativas em anéis, sinalizações com ícones e níveis.
- Justificativas com editor lateral e importação em janela modal; exportação com escolha de idioma em cartões.
- Componentes compartilhados (`src/components/ui.module.css`, ícones SVG próprios), sem novas dependências.

### Entrega (Fase 7)
- Testes de ponta a ponta no navegador (Playwright) no CI, com guarda contra qualquer requisição externa.
- Manual do usuário dentro do app (Ajuda), versão no rodapé e na rastreabilidade, cópia de segurança única da
  configuração e das justificativas.
