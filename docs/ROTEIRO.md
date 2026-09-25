# Roteiro de desenvolvimento

Cada fase é uma sessão (ou poucas) no Claude Code. Em cada uma: pedir o plano primeiro, revisar, aprovar,
e só então implementar. Fazer commit ao final de cada fase com os testes passando.

---

## Fase 0 — Estrutura do projeto

**Prompt:**
> Leia CLAUDE.md, docs/ARQUITETURA.md e docs/REGRAS_CFGR700.md. Crie a estrutura inicial do projeto:
> Vite + React + TypeScript strict, Vitest, ESLint, a estrutura de pastas do CLAUDE.md, um worker vazio com o
> protocolo de mensagens tipado, a CSP no index.html, o .gitignore (incluindo local/) e o workflow do GitHub
> Actions que publica no GitHub Pages. Tela inicial com área de upload e o aviso de que os arquivos não saem
> do computador. Antes de criar arquivos, apresente o plano.

**Pronto quando:** `npm run dev`, `npm run build` e `npm run test` funcionam; a página publicada abre no GitHub Pages.

---

## Fase 1 — Prova de conceito da leitura (a fase mais importante)

**Prompt:**
> Implemente a ingestão descrita em ARQUITETURA.md seções 1.1 a 1.3: leitor de ZIP com acesso aleatório,
> descompressão em fluxo com DecompressionStream('deflate-raw') e fallback fflate, conferência de CRC32 e
> tamanho, leitura da sharedStrings (com texto rico e entidades), parser em fluxo da aba do relatório,
> classificação das linhas (cabeçalho repetido, branco, detalhe, com lacunas de linha contando como branco),
> leitura da aba de parâmetros e armazenamento colunar com dicionário. Mostre o progresso por etapa na UI
> (seção 4 da arquitetura) e a tela de reconciliação. Comece pelo gerador de arquivos sintéticos e pelos
> testes; depois implemente. Inclua o teste local que compara com local/golden.json (reconciliação de linhas
> e eventos por operação).

**Pronto quando:**
- Testes sintéticos passando.
- Com os dois arquivos reais em `local/`: reconciliação idêntica ao `golden.json`.
- Medido no computador do trabalho: tempo de leitura, pico de memória (Gerenciador de tarefas do navegador,
  Shift+Esc no Chrome/Edge) e UI sem travar. Registrar os números em `docs/MEDICOES.md`.

**Se a memória ou o tempo não atenderem:** parar e discutir antes de seguir (ex.: reduzir colunas guardadas,
processar por blocos, pedir o relatório em CSV).

---

## Fase 2 — Motor de análise

**Prompt:**
> Implemente o motor descrito em REGRAS_CFGR700.md seções 3 a 7 e o critério de corte da seção 6, como funções
> puras em src/worker/engine, dirigidas pela configuração padrão config/defaults/ct2.json (crie o schema zod).
> Casos sintéticos para cada regra primeiro. Depois, testes locais contra local/golden.json: estatísticas de
> cada arquivo, do consolidado e os painéis por período. Implemente os invariantes da seção 11.

**Pronto quando:** todos os números do `golden.json` batem (arquivo de agosto sozinho, setembro sozinho e os
dois juntos), incluindo os painéis de 17–24/08, 25–31/08, 01–04/09 e log completo.

---

## Fase 3 — Painel e navegação

**Prompt:**
> Crie o painel: seletor de período (presets da configuração + personalizado), quadros de categorias por origem,
> composição por data contábil, período × demais dias × log completo, sinalizações, cobertura de justificativas
> e movimento diário. Tabelas virtualizadas para Documentos, Base de linhas, Exclusões, Alterações,
> Desbalanceados e Alterações descartadas, com filtro, ordenação e busca, paginadas pelo worker. Ao clicar num
> número do painel, abrir a tabela já filtrada. Interface moderna, sóbria, pensada para uso profissional,
> fonte Aptos com fallback Segoe UI.

**Pronto quando:** navegação fluida com o arquivo grande; números do painel iguais aos da Fase 2.

---

## Fase 4 — Justificativas

**Prompt:**
> Implemente as justificativas da seção 9 de REGRAS_CFGR700.md: listas de documentos com exclusão e com
> alteração, edição na UI, importação de uma planilha exportada anteriormente (abas de justificativa, pela chave)
> e de JSON, exportação em JSON, cópia em IndexedDB, sinalização de documentos já justificados que voltaram a
> ser movimentados em outro arquivo, e a cobertura por período no painel.

---

## Fase 5 — Exportação XLSX

**Prompt:**
> Implemente o gerador XLSX em fluxo da seção 5 de ARQUITETURA.md e as abas listadas, reproduzindo o modelo
> de papel de trabalho (painel com filtro por lista suspensa e datas, fórmulas vivas, nomes definidos,
> formatação condicional). Respeite as regras de planilha do CLAUDE.md (busca com tratamento de vazio, sem TEXT
> com formato de data, sem mesclagem sobreposta). Inclua a aba Rastreabilidade. Teste reabrindo o arquivo
> gerado e conferindo estrutura, fórmulas e datas.

**Pronto quando:** o arquivo abre no Excel sem mensagem de reparo, recalcula sem erros e o painel mostra os
mesmos números da ferramenta em todos os presets.

---

## Fase 6 — Configuração e generalização

**Prompt:**
> Crie a tela de configuração (formulário sobre o schema zod, com importar/exportar JSON e restaurar padrão).
> Prepare o motor para outras tabelas auditadas pelo CFGR700 (chave do documento, campos e mapas vindos da
> configuração), sem quebrar a configuração CT2.

---

## Dicas de uso do Claude Code

- Anexe ao pedido o trecho da documentação relevante para a fase, além do CLAUDE.md.
- Peça sempre "testes primeiro" e "mostre o plano antes".
- Quando um número não bater com o golden, peça para investigar a divergência caso a caso antes de ajustar
  qualquer regra; regra só muda com decisão registrada em REGRAS_CFGR700.md.
- Não cole dados reais no chat se o repositório for público; use os arquivos em `local/`.
