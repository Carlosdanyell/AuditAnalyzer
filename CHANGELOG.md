# Histórico de versões

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); as versões seguem SemVer.

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
