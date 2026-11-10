# Fase 14 — Integridade da CT2: Painel de composição, visão Achados e subtipos de I3/I4

Descrição de execução para o Claude Code. Base: versão 2.1.0 (commit `de34c72`). Leia antes `CLAUDE.md`,
`docs/REGRAS_CT2_INTEGRIDADE.md`, `docs/INTERFACE.md` e `docs/MODULOS.md`. Todas as restrições do `CLAUDE.md`
continuam valendo (nada sai da máquina, memória controlada, determinismo, **repositório público sem dados reais**).

---

## 1. Motivação (observada pelo usuário numa extração mensal real)

1. **I4 gera ruído.** A rotina de lançamento manual (CTBA102) grava "Valor Moeda1" = 0 em todas as linhas; toda linha
   manual vira exceção I4. Entre as exceções, porém, há um sinal útil: linhas automáticas (ex.: CTBANFE) cujo "Valor"
   foi reduzido depois da geração, com linhas manuais inseridas no mesmo documento para ratear o valor. "Valor Moeda1"
   conserva o valor gerado pela rotina, e a diferença revela a alteração manual de um lançamento automático.
2. **I3 sem contexto.** "Mesma conta no débito e no crédito" era, no caso real, uma reclassificação de centro de custo
   (mesma conta, CC diferente). O usuário só descobriu abrindo a Base: a grade de exceções não mostra contas,
   entidades nem histórico.
3. **Falta dimensão da extração.** O Painel atual é um quadro de testes. Faltam quantitativos e visuais da composição:
   lançamentos, documentos por origem (manual, automático, misto), distribuição por rotina e por dia, lotes com
   intervenção manual.

## 2. Decisões do usuário (10/11/2026) — registrar em `REGRAS_CT2_INTEGRIDADE.md`, seção 13

- **Navegação:** separar "o que há na extração" (Painel) de "o que verificar" (nova visão **Achados**), como itens
  próprios no trilho.
- **I3 e I4 divididos** em subtipos, com as severidades padrão da tabela da seção 3.2.
- **I4a não é alerta:** alteração de lançamento automático deve ter documento de aprovação; o teste é Info, mas aparece
  **aberto** em Achados, no grupo "Conferir com documento de aprovação".
- **Planilha:** os subtipos, a origem do documento e as colunas de contexto entram também na planilha exportada,
  amarrados por fórmulas como os demais testes.
- **Fora desta fase:** conferência automática com os pacotes de lançamento manual assinados (leitura dos nomes dos
  PDFs) — fica para a próxima fase; não criar nada dela agora. Usuário a partir de "Origem" continua fora do escopo
  (seção 12, item 4).

---

## 3. Motor e configuração (`src/config`, `src/worker/modules/ct2Integrity`, `src/shared`)

### 3.1 Novas colunas opcionais

Acrescentar em `src/config/defaults/ct2-integrity.json` e no schema (títulos conferidos no layout real da extração):

| Campo | Título | Alias |
|---|---|---|
| `costCenterDebit` | C Custo Deb | CT2_CCD |
| `costCenterCredit` | C Custo Crd | CT2_CCC |
| `itemDebit` | Item Debito | CT2_ITEMD |
| `itemCredit` | Item Credito | CT2_ITEMC |
| `valueClassDebit` | Cl Vlr Deb | CT2_CLVLDB |
| `valueClassCredit` | Cl Vlr Cred | CT2_CLVLCR |

Todas `required: false`. Guardar como texto codificado por dicionário (mesmo padrão das demais colunas de texto do
`store.ts`). Medir o pico de memória com `MEDIR_CT2=1 npm run test:local` antes e depois; registrar em `docs/MEDICOES.md`.

### 3.2 Testes que substituem I3 e I4

`CT2_TESTS` perde `I3` e `I4` e ganha os cinco abaixo (23 códigos; cabem nos 32 bits de `marks.ts`).
"Entidades" = centro de custo, item contábil e classe de valor; coluna ausente conta como vazio.

| Código | Nível | Severidade padrão | Regra (exceção quando verdadeira) |
|---|---|---|---|
| I3a | Linha | Info | Partida Dobrada, conta débito = conta crédito (não vazia) e **pelo menos uma** entidade diferente entre débito e crédito. Reclassificação entre entidades. |
| I3b | Linha | Alerta | Partida Dobrada, conta débito = conta crédito e **todas** as entidades iguais. Lançamento sem efeito contábil. |
| I4a | Linha | Info (grupo "Conferir com documento de aprovação") | Moeda = moeda local, "Valor Moeda1" legível e ≠ 0, e "Valor" ≠ "Valor Moeda1". Valor alterado após a geração. |
| I4b | Linha | Info | Moeda = moeda local, tipo ≠ Cont.Hist, "Valor" ≠ 0, "Valor Moeda1" = 0 e linha **manual** (códigos de `manualFlag.manual`). Campo não preenchido pela rotina manual. |
| I4c | Linha | Alerta | Como I4b, mas linha **não manual** (automática ou não identificada). Não esperado em rotina automática. |

- "Valor Moeda1" vazio ou ilegível continua fora do teste (o aviso de valores ilegíveis já existe em `checks.ts`).
- Sem nenhuma coluna de entidade mapeada, toda mesma conta cai em I3b: declarar em §10 (Limitações) e no painel.
- Rótulos pt/en em `CT2_TEST_INFO` e `workpaperLabels.ts`.
- Marcar em `CT2_TEST_INFO` o atributo de apresentação do I4a (ex.: `review: 'approval'`) em vez de tratar o código na
  tela; a severidade continua editável na Configuração.

### 3.3 Migração da configuração e das cópias de segurança

- `schemaVersion` 2 → 3, seguindo o padrão de migração já existente em `ct2IntegritySchema.ts`. O `enabled` do I3
  antigo passa para I3a e I3b, o do I4 para I4a, I4b e I4c; as severidades novas vêm do padrão (não herdar o "warning"
  do I4 antigo).
- `readBackup` deve restaurar cópias da versão anterior aplicando a mesma migração; teste unitário para isso.

### 3.4 Origem do documento

Atributo calculado uma vez na análise, por documento, a partir de "Lcto Manual?" de todas as suas linhas (códigos de
`manualFlag`):

| Origem | Regra |
|---|---|
| Automático | só códigos automáticos (linhas não identificadas são ignoradas se houver ao menos um código reconhecido) |
| Manual | só códigos manuais |
| Misto | códigos manuais e automáticos no mesmo documento (lançamento automático com intervenção manual) |
| Não identificado | nenhum código reconhecido (inclui a coluna ausente) |

"Lote com intervenção manual" = lote com ao menos um documento Manual ou Misto.

### 3.5 Motivo da exceção

Texto gerado pelo worker para cada linha de exceção, com os valores formatados por `src/shared/format.ts`:

- I3a: `Conta <conta> em D e C; CC <ccD> → <ccC>` (citar só as entidades que diferem; item e classe no mesmo formato).
- I3b: `Conta <conta> em D e C com as mesmas entidades`.
- I4a: `Valor gerado <Valor Moeda1> → atual <Valor>; documento com <n> linha(s) manual(is)`.
- I4b/I4c: `Valor Moeda1 não preenchido (<origem da linha>)`.
- Demais testes de linha: descrição curta da condição, no mesmo estilo.

### 3.6 Novos comandos do worker (`src/shared/protocol.ts`)

- **`overview`** (filtros da seção 4.1) → indicadores, distribuição por rotina, por dia, por origem e a lista de lotes
  com intervenção manual. Agregar a partir dos typed arrays e da origem pré-calculada; resposta pequena (sem linhas).
  Medir o tempo com 1 milhão de linhas; se passar de ~200 ms, pré-agregar por documento.
- **`document`** (índice do documento) → todas as linhas do documento com as colunas mapeadas, entidades, "Valor
  Moeda1", "Lcto Manual?", marcas dos testes e motivo; cabeçalho com chave, segmento(s), rotinas, origem, débito e
  crédito **por segmento** e situação de B1/B4.
- **`page`**: `Ct2TableFilter` passa a aceitar `origin`, `routine`, `batch` e `day` além de `segment` e `test`; a
  chave do cache de linhas em `tables.ts` inclui todos os filtros.

**Regra que não muda:** valores nunca são somados entre tipos de saldo e moedas. Contagens podem usar "Todos os
segmentos"; débito, crédito e percentuais em valor aparecem por segmento.

---

## 4. Interface (`src/app`, `src/components`)

### 4.1 Navegação e filtro comum

Trilho da CT2: **Reconciliação · Painel · Achados · Tabelas · Exportação** (Configuração e Ajuda no pé, como hoje).

- "Achados" é nova visão do módulo (descritor em `src/modules/ct2Integrity/module.ts` e área em `Ct2Workspace.tsx`).
  O rótulo não pode conter "Painel", "Analisar", "Ajuda", "Configuração", "Cancelar", "Nova análise" nem
  "Exportar planilha" (busca dos testes e2e por trecho).
- **Barra de filtros comum** a Painel, Achados e Tabelas, com o estado em `Ct2Workspace` (substitui o seletor de
  segmento de cada visão): Segmento, Origem (seleção múltipla), Rotina, Lote, Dia. Cada filtro ativo é um chip
  removível ("Remover filtro …"); um botão limpa todos. Clicar num elemento de gráfico ou num número cria o filtro
  correspondente. Filtro que não se aplica a uma tabela (ex.: Origem na aba Dias) aparece esmaecido com a dica
  "não se aplica a esta tabela".
- Faixa de indicadores-chave (`figuresOf`): Lançamentos (linhas com valor), Documentos, Lotes, Desbalanceados,
  Exceções (Erro + Alerta), Para conferência (ocorrências de I4a + documentos mistos), Período.

### 4.2 Reconciliação

Como hoje, recebendo a **matriz de amarração** que hoje fica no fim do Painel.

### 4.3 Painel (composição da extração; tudo respeita os filtros)

1. **Indicadores:** lançamentos com valor; linhas de continuação de histórico; documentos; lotes; documentos por
   origem (Automático, Manual, Misto, Não identificado — cada número aplica o filtro); lotes com intervenção manual;
   débito total e % do débito em linhas manuais (por segmento).
2. **Por rotina:** barras horizontais ordenadas, com alternância Linhas | Documentos | Débito; cada barra empilhada
   por origem. Clique = filtro Rotina.
3. **Por dia:** colunas por dia, com alternância Linhas | Débito; dias não úteis (mesma regra do E6, feriados da
   plataforma) com marca própria. Clique = filtro Dia.
4. **Lotes com intervenção manual:** tabela com data(s), lote, sub-lote, documentos manuais, documentos mistos, linhas,
   débito (por segmento) e histórico da 1ª linha do 1º documento. Clique no lote = filtro Lote; clique no documento =
   painel lateral.
5. **Perfil** (P1/P2 que hoje estão no Painel: por rotina, por lançamento padrão, por "Lcto Manual?"), recolhido.

Gráficos em SVG próprio, sem nova dependência; cores só pelos tokens de `global.css`, legíveis nos dois temas; cada
barra é um botão acessível com rótulo no formato "<rotina>: <n> linhas"; números nunca
animados; respeitar `prefers-reduced-motion`. Vermelho continua reservado a achados e à visão ativa.

### 4.4 Achados (o que verificar)

1. **Parâmetros da execução** (movidos do Painel, recolhidos, com "Reaplicar os testes").
2. **Exceções — Erro e Alerta:** aberto; um bloco por teste com ocorrência, mostrando as primeiras ocorrências com o
   motivo e "Ver todas" (abre Tabelas › Exceções com o teste).
3. **Conferir com documento de aprovação:** aberto; ocorrências de I4a e a lista de documentos mistos.
4. **Informativos:** testes Info com ocorrência, recolhidos com a contagem no título.
5. **Sem ocorrência:** uma linha recolhida ("N teste(s) sem ocorrência").
6. **Documentos desbalanceados** (B1/B4/B5) e **maiores documentos** (P4), movidos do Painel.

Cada ocorrência abre o painel lateral do documento.

### 4.5 Tabelas

- Documentos ganha a coluna "Origem do documento"; Lotes ganha "Documentos manuais" e "Documentos mistos".
- Exceções ganha as colunas de contexto: Conta D, Conta C, CC D, CC C, Item D, Item C, Classe D, Classe C (só as
  mapeadas), Valor, Valor Moeda1, Histórico, Rotina, Lcto Manual?, Motivo e Grupo (Exceção / Conferir com aprovação /
  Informativo).
- Clique numa linha de Documentos, Exceções ou Base abre o painel lateral.

### 4.6 Painel lateral do documento

Diálogo lateral (`role="dialog"`, foco preso, Esc fecha) com o resultado do comando `document`: cabeçalho
(chave, data, origem, rotinas, D/C por segmento, B1/B4) e as linhas, com marca discreta (não vermelha) nas linhas
manuais e marca de achado nas linhas com exceção; "Valor Moeda1" visível quando difere de "Valor". Botão "Ver na Base"
abre Tabelas › Base filtrada pelo documento.

---

## 5. Planilha exportada (`workpaper.ts`, `workpaperLabels.ts`) — tudo por fórmula

- **Criterios:** novos nomes definidos `P_COD_MANUAL` e `P_COD_AUTO` (listas dos códigos de `manualFlag`); descrição
  dos testes novos e das limitações.
- **Base:** colunas de entidade mapeadas; colunas de teste I3a, I3b, I4a, I4b, I4c no lugar de I3 e I4, com fórmulas
  equivalentes às regras da seção 3.2 (I4b/I4c usam `COUNTIF(P_COD_MANUAL, <Lcto Manual?>)`).
- **Documentos:** "Origem do documento" por fórmula sobre o bloco contíguo da Base
  (`SUMPRODUCT(COUNTIF(<bloco>, P_COD_MANUAL))>0` e o equivalente para automático).
- **Lotes:** "Documentos manuais" e "Documentos mistos" por `COUNTIF` sobre o bloco de Documentos.
- **Excecoes:** colunas de contexto por `INDEX` na Base, "Motivo" por fórmula de texto (no idioma escolhido) e "Grupo".
  "Confirmada na origem?" continua valendo para os códigos novos.
- **Resumo:** quadro de testes com os códigos novos ("Confere"); bloco "Composição por origem" (documentos e linhas
  por origem; débito das linhas manuais e automáticas por segmento) com `COUNTIFS`/`SUMIFS` sobre Documentos e Base.
- `xlsxEval` deve avaliar as funções novas (estender se preciso); determinismo byte a byte mantido.
- Medir o recálculo no LibreOffice com 300 mil linhas (são 3 colunas de fórmula a mais por linha); se o teto de
  600 mil linhas ficar inviável, parar e perguntar ao usuário antes de mudar o limite.

---

## 6. Documentação e versão

- `REGRAS_CT2_INTEGRIDADE.md`: §6.2 (tabela nova), §6.4 (origem do documento), §7 (abas e colunas), §9 (tela),
  §10 (limitações: I3b sem entidades mapeadas; origem depende de "Lcto Manual?"), §13 (decisões de 10/11/2026).
- `INTERFACE.md`: telas 3, 4 e 5, a visão Achados, a barra de filtros, o painel lateral e os nomes novos usados nos
  testes e2e.
- `ROTEIRO.md`: Fase 14 com o prompt e o "Pronto quando".
- `public/ajuda.html` (seção da CT2), `CHANGELOG.md` (`[2.2.0]`), versão 2.2.0.

---

## 7. Testes

- **Sintéticos** (`tests/synthetic/ct2EngineFixture.ts`): um caso por regra nova — I3a (só CC difere; só item difere),
  I3b (com e sem colunas de entidade), I4a, I4b, I4c, Valor Moeda1 vazio (não testado), documento de cada origem
  (incluindo Misto e Não identificado), lote com e sem intervenção manual. Nenhum dado real.
- **Unidade:** migração da configuração v2 → v3 e de cópia de segurança antiga; `overview` — soma das barras =
  indicador = total da tabela aberta com o mesmo filtro, em todos os segmentos; `document` — linhas e totais iguais
  à Base.
- **Planilha:** `xlsxEval` com matriz toda OK, quadro "Confere", Excecoes toda "Confirmada", origem e contagens de
  Lotes iguais ao motor.
- **Ponta a ponta** (`tests/e2e/modules.spec.ts`): Painel → clique numa rotina → chip na barra → Tabelas filtradas;
  Achados com os grupos; abrir e fechar o painel lateral; nenhuma requisição externa.
- **Local** (`local/ct2/golden-ct2-integrity.json`, fora do git): o usuário informa as contagens de referência da
  extração real (ocorrências por código novo, documentos por origem, lotes com intervenção manual, lançamentos com
  valor).

---

## 8. Ordem de execução

Mostre o plano antes de começar e escreva os testes primeiro em cada etapa. Uma etapa por commit, com
`npm run test`, `npm run lint` e `npm run build` passando ao fim de cada uma.

1. Configuração: colunas novas, códigos novos, migração v2 → v3 e cópias de segurança.
2. Motor: testes I3a–I4c, origem do documento, motivo, comandos `overview` e `document`, filtros novos em `page`.
3. Planilha: colunas, nomes definidos, fórmulas, Resumo; `xlsxEval` e medição de recálculo.
4. Tela: trilho, barra de filtros, Painel, Achados, Reconciliação com a matriz, colunas novas das Tabelas, painel
   lateral, faixa de indicadores.
5. Documentação, ajuda, CHANGELOG, versão 2.2.0; `npm run test:e2e`; medição de memória e tempo.

Pare e pergunte ao usuário se: uma regra da seção 3 não puder ser aplicada como escrita; o golden local divergir;
o teto da planilha precisar mudar; ou a memória passar das metas do `CLAUDE.md`.

## 9. Pronto quando

- Cada número do Painel e de Achados = total da tabela aberta pelo clique = valor correspondente no Resumo da planilha,
  em todos os segmentos e com os filtros combinados.
- Com a extração real em `local/`, as contagens batem com o golden informado pelo usuário.
- e2e, unidade, lint e build passando; memória e tempo dentro das metas; nenhum dado real no repositório.

---

## Prompt para colar no Claude Code

> Leia `docs/FASE_14_CT2_PAINEL_ACHADOS.md`, o `CLAUDE.md`, `docs/REGRAS_CT2_INTEGRIDADE.md` e `docs/INTERFACE.md`.
> Implemente a Fase 14 na ordem da seção 8, uma etapa por commit, mostrando o plano antes de começar e escrevendo os
> testes primeiro. Pare e me pergunte nas situações listadas no fim da seção 8.
