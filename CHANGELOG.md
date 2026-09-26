# Histórico de versões

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); as versões seguem SemVer.

## [1.0.0] — a publicar

Primeira versão para uso da contabilidade. Será publicada (tag e release) depois da nova interface.

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

### Entrega (Fase 7)
- Testes de ponta a ponta no navegador (Playwright) no CI, com guarda contra qualquer requisição externa.
- Manual do usuário dentro do app (Ajuda), versão no rodapé e na rastreabilidade, cópia de segurança única da
  configuração e das justificativas.
