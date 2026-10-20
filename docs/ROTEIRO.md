# Roteiro de desenvolvimento

Cada fase é uma sessão (ou poucas) no Claude Code. Em cada uma: pedir o plano primeiro, revisar, aprovar,
e só então implementar. Fazer commit ao final de cada fase com os testes passando.

## Situação

| Fase | Situação |
|---|---|
| 0 — Estrutura | concluída |
| 1 — Leitura | concluída; `golden.json` confere com os dois arquivos |
| 2 — Motor | concluída em 26/09/2026; todos os números do `golden.json` conferem (arquivos sozinhos, consolidado, painéis e casos pontuais) |
| 3 — Painel e tabelas | concluída; painéis da tela conferem com o golden |
| 4 — Justificativas | concluída; importação testada com o papel de trabalho anterior real |
| 5 — Exportação XLSX | concluída em 26/09/2026; Resumo = ferramenta em todos os atalhos (arquivos reais, PT e EN); Excel recalcula sem erros e sem reparo |
| 6 — Configuração | concluída em 26/09/2026 para a CT2 (tela, versões, importação/exportação); generalização para outras tabelas fora do escopo |
| 7 — Entrega | concluída (testes de ponta a ponta no CI, ajuda, versão, cópia de segurança); nova interface entregue; versão 1.0.0 publicada |
| 8 — Plataforma de módulos | a fazer (`docs/MODULOS.md`) |
| 9 — CT2 Integridade: leitura | a fazer (`docs/REGRAS_CT2_INTEGRIDADE.md` seções 2–4) |
| 10 — CT2 Integridade: motor | a fazer (seções 5, 6 e 8) |
| 11 — CT2 Integridade: planilha amarrada | a fazer (seção 7) |
| 12 — CT2 Integridade: painel e tabelas | a fazer (seção 9) |
| 13 — Entrega da versão 2.0 | a fazer |

Verificado pelo usuário em 26/09/2026 no computador do trabalho: tempos, memória e a planilha exportada no Excel,
todos dentro do esperado (ver MEDICOES.md).

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

**Decisão (26/09/2026):** a ferramenta atende só a contabilidade (CT2). A generalização para outras tabelas saiu do
escopo; se outra área precisar, será uma ferramenta própria. A Fase 6 entregou a configuração completa da CT2 e
tirou dos textos os nomes de campo fixos. A interface poderá ser recriada por outro agente seguindo
`docs/INTERFACE.md`.

---

## Fase 7 — Entrega (versão 1.0)

Testes de ponta a ponta no navegador (Playwright, no CI) com guarda de privacidade, manual do usuário dentro do app,
versão no rodapé e na rastreabilidade, cópia de segurança única (configuração + justificativas) e `CHANGELOG.md`.
A interface será recriada por outro agente seguindo `docs/INTERFACE.md`; os testes de ponta a ponta são o critério de
aceite. Depois disso: versão 1.0.0 em `package.json`, tag `v1.0.0` e release no GitHub.

---

## Fase 8 — Plataforma de módulos

**Decisão (20/10/2026):** o AuditAnalyzer passa a ser uma plataforma com vários módulos de análise (revoga a decisão
da Fase 6 sobre generalização). Ver `docs/MODULOS.md`.

**Prompt:**
> Leia CLAUDE.md, docs/MODULOS.md e docs/INTERFACE.md. Transforme o app em plataforma: registro de módulos
> (`src/modules/registry.ts`), seletor de análises na tela inicial, `module` no comando `ingest`, adaptador
> `worker/modules/cfgr700` sobre o motor atual, configuração por módulo no IndexedDB com migração da chave atual,
> cópia de segurança com todas as configurações (lendo as cópias antigas) e feriados como configuração da
> plataforma. Registre o módulo `ct2Integrity` só como cartão "em breve". O módulo CFGR700 não pode mudar de
> comportamento. Apresente o plano antes.

**Pronto quando:** todos os testes atuais passam sem mudar expectativas (inclusive `generalMode.test.ts` e
`npm run test:e2e`, com o passo extra de escolher o módulo); a cópia de segurança antiga é restaurada sem perda.

---

## Fase 9 — CT2 Integridade: leitura

**Prompt:**
> Leia docs/REGRAS_CT2_INTEGRIDADE.md seções 2 a 4. Primeiro o gerador sintético de extração CT2 (layout real,
> casos da seção 11) e os testes; depois a ingestão sobre a leitura compartilhada: cabeçalho por títulos, aliases,
> códigos como texto, centavos, datas, linha de origem, ordenação estável pela chave da linha, reconciliação de
> leitura e invariantes CI-1, CI-2 e CI-4. Teste local com a extração real em local/ contra
> local/golden-ct2-integrity.json (linhas, documentos, débito e crédito).

**Pronto quando:** sintéticos e local passando; tempo e memória medidos em `docs/MEDICOES.md`.

---

## Fase 10 — CT2 Integridade: motor

**Prompt:**
> Implemente as seções 5, 6 e 8: aglutinação por documento, lote e dia em centavos, os testes B, I, E e P dirigidos
> pela configuração `config/defaults/ct2-integrity.json` (schema zod próprio), as marcas por linha e por nível, a
> lista de exceções e os invariantes CI-3, CI-5, CI-6, CI-9 e CI-10. Casos sintéticos primeiro. Não decida nada da
> seção 12: onde a regra estiver pendente, deixe o teste desligado na configuração e pergunte.

**Pronto quando:** cada caso sintético produz exatamente as exceções esperadas; local confere com o golden
(desbalanceados e compensação adjacente).

---

## Fase 11 — CT2 Integridade: planilha amarrada

**Prompt:**
> Implemente a exportação da seção 7 sobre o gerador XLSX existente: nomes definidos de parâmetros, Base com colunas
> de teste por fórmula, Documentos/Lotes/Dias por blocos (`SUM`/`ROWS`, nunca SUMIFS por linha), Excecoes com
> confirmação por INDEX, Resumo com matriz de amarração e quadro de testes, Perfil e Rastreabilidade, em pt e en.
> Estenda `tests/support/xlsxEval.ts` com ROWS, COUNTA, WEEKDAY, COUNTIF e SUMIF (com testes). Meça o recálculo no
> Excel com 40 mil, 300 mil e 1 milhão de linhas sintéticas e registre em MEDICOES.md; se não for viável, pare e
> discuta.

**Pronto quando:** no avaliador, matriz toda OK, quadro de testes "Confere" e Excecoes toda "Confirmada"; mudar um
parâmetro muda os status como o motor; no Excel, abre sem reparo e recalcula sem erros (teste local com
`EXCEL_CHECK=1`); visual conferido em PDF.

---

## Fase 12 — CT2 Integridade: painel e tabelas

**Prompt:**
> Implemente a seção 9: parâmetros antes de processar, painel (indicadores, matriz de amarração, quadro de testes
> clicável, desbalanceados com compensação, maiores documentos, perfil) e as tabelas virtualizadas, seguindo
> INTERFACE.md. Testes de tela e de ponta a ponta com o sintético.

**Pronto quando:** cada número do painel = total da tabela aberta = Resumo da planilha; e2e passando.

---

## Fase 13 — Entrega da versão 2.0

Ajuda (seção do novo módulo e do seletor), README (plataforma e módulos), CHANGELOG, versão 2.0.0, tag e release.

---

## Dicas de uso do Claude Code

- Anexe ao pedido o trecho da documentação relevante para a fase, além do CLAUDE.md.
- Peça sempre "testes primeiro" e "mostre o plano antes".
- Quando um número não bater com o golden, peça para investigar a divergência caso a caso antes de ajustar
  qualquer regra; regra só muda com decisão registrada em REGRAS_CFGR700.md.
- Não cole dados reais no chat se o repositório for público; use os arquivos em `local/`.
