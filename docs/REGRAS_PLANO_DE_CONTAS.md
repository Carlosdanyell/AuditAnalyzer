# Regras do módulo Plano de contas (`chartOfAccounts`)

> Recebe o CSV do plano de contas exportado do Protheus (tabelas CT1 + CVD), valida a integridade do arquivo e gera a
> planilha no padrão da aba **"Doc-01-Plano de Contas"**. Situação: **prévia** desde 25/11/2026, até a conferência com o
> arquivo real (seção 9.4). Números de referência reais e arquivos reais ficam em `local/plano-de-contas/` (fora do git).

Código: `src/worker/modules/chartOfAccounts/` (parse, validate, transform, layout, workbook, ingest, index),
`src/modules/chartOfAccounts/module.ts` (descritor), `src/app/modules/chartOfAccounts/` (telas),
`src/config/chartOfAccountsSchema.ts` e `src/config/defaults/chart-of-accounts.json` (domínios).

---

## 1. Objetivo e critério de pronto

1. Ler o CSV (CT1 + CVD) exportado do Protheus;
2. validar a integridade (seção 4);
3. devolver um `.xlsx` no layout da seção 6.

**Pronto:** a planilha gerada a partir do CSV real tem os mesmos valores e a mesma formatação da planilha de referência
(seção 9.4), sem divergências.

## 2. Restrições (além das do `CLAUDE.md`)

- Tudo no navegador, em Web Worker, com progresso por etapa; nenhuma chamada de rede com dados.
- O CSV nunca é gravado no navegador (nem `localStorage`, `IndexedDB` ou cache) e nunca entra no repositório (`*.csv`
  no `.gitignore`).
- **Gerador XLSX:** o próprio da plataforma (`src/worker/export/xlsxWriter.ts`), não ExcelJS. Decisão de 25/11/2026: o
  `CLAUDE.md` manda usar o gerador próprio quando ele existe, e ele cobre tudo o que o layout pede depois de receber
  nível de estrutura de tópicos por linha, `summaryBelow`, `outlineLevelRow`, margens de página, fonte padrão da pasta
  e o formato `@` como formato embutido (id 49). Nenhuma dependência nova.

## 3. Arquivo de entrada

### 3.1 Formato físico

| Item | Regra |
|---|---|
| Codificação | UTF-8 quando a decodificação estrita (`fatal: true`) passa; senão windows-1252. A escolhida aparece no Resumo. |
| Separador | `;` |
| Quebra de linha | CRLF ou LF |
| Aspas | Aceitas: campo entre aspas pode ter `;`, aspas duplicadas (`""`) e quebra de linha. A numeração de linhas é a física. |
| Espaços | `trim()` em todo valor (campos de largura fixa). |
| Quantidade | Um único `.csv` por análise (a tela e o worker recusam outros). |

### 3.2 Estrutura lógica

A primeira coluna dá o tipo do registro: `0` linha de controle (`0;CT1;CVD`), `1` CT1, `2` CVD. Cada cabeçalho é achado
pelo conteúdo (`CT1_FILIAL` ou `CVD_FILIAL` na segunda coluna), nunca pela posição da linha; os campos são lidos **pelo
nome** do cabeçalho. Linhas em branco são ignoradas (e contadas).

Ficam de fora, com aviso na Reconciliação (não bloqueiam): linhas de tipo desconhecido, registros antes do cabeçalho da
sua tabela e um segundo cabeçalho da mesma tabela. Registro com **menos** campos que o cabeçalho, ou com campos a mais
preenchidos, também gera aviso (os campos são lidos pela posição do cabeçalho; campos vazios no fim são aceitos).

A tela inicial reconhece o arquivo pela linha de controle ou pelo cabeçalho da CT1 (`src/shared/tableExport.ts`), para o
aviso "Este arquivo parece ser…" quando carregado em outra análise.

### 3.3 Campos usados

**CT1:** `CT1_CONTA`, `CT1_DESC01`, `CT1_DESC02`, `CT1_CLASSE`, `CT1_NORMAL`, `CT1_CTASUP`, `CT1_RES`, `CT1_NTSPED`,
`CT1_BLOQ`, `CT1_DTBLIN`, `CT1_DTBLFI`, `CT1_DC`, `CT1_ACCUST`, `CT1_CCOBRG`, `CT1_ACITEM`, `CT1_ITOBRG`, `CT1_ACCLVL`,
`CT1_DTEXIS`. **CVD:** `CVD_CONTA`, `CVD_CTAREF`, `CVD_CTASUP`, `CVD_CODPLA`. Os demais campos não são guardados.

## 4. Validações

Todas rodam antes de gerar o arquivo e aparecem no Resumo, cada uma com a lista de ocorrências (linha do arquivo, conta(s)
e o que foi achado; até 500 por código na tela, contagem sempre completa).

### 4.1 Bloqueantes — impedem a planilha, **sem opção de confirmar**

| Código | Regra |
|---|---|
| E01 | Arquivo sem cabeçalho CT1. Sem ele, nada mais é avaliado. |
| E02 | Ausência de algum campo CT1 da 3.3 (ocorrência na linha do cabeçalho). Sem eles, nada mais é avaliado. |
| E03 | `CT1_CONTA` vazio. |
| E04 | `CT1_CONTA` repetido (ocorrência na linha da repetição; a primeira é a usada). |
| E05 | `CT1_CTASUP` com conta inexistente no CT1. |
| E06 | Ciclo na hierarquia (inclui conta superior de si mesma); uma ocorrência por ciclo, a partir da conta que vem primeiro no arquivo. |
| E07 | Data em `CT1_DTBLIN`, `CT1_DTBLFI` ou `CT1_DTEXIS` fora de `AAAAMMDD` ou inexistente (ex.: 20250231). Vazio é aceito. Ano antes de 1901 também é E07 (fora do intervalo de datas do Excel; regra da plataforma). |

Diferente das invariantes dos outros módulos (que permitem exportar com confirmação registrada), aqui a especificação
diz que o erro bloqueante impede a geração: o botão fica desabilitado e o worker recusa a exportação mesmo com
`confirmFailures`.

### 4.2 Alertas — não impedem

| Código | Regra |
|---|---|
| A01 | Cabeçalho CVD ausente, ou sem algum campo CVD da 3.3: as colunas S, T e U ficam vazias e A02–A05 e A09 não têm o que ver. |
| A02 | Conta analítica sem vínculo CVD. |
| A03 | Conta sintética com vínculo CVD (a conta referencial é escrita assim mesmo). |
| A04 | Registro CVD de conta inexistente no CT1 (órfão), na linha do registro CVD. |
| A05 | Mais de um registro CVD para uma conta do CT1: vale o primeiro; os demais são listados. |
| A06 | Conta filha antes da conta superior no arquivo. |
| A07 | Código fora do domínio (seção 5.2) em `CT1_CLASSE`, `CT1_NORMAL`, `CT1_NTSPED`, `CT1_BLOQ` ou nos campos Sim/Não; o código é gravado como veio. |
| A08 | Conta sintética com código reduzido (`CT1_RES`) preenchido. |
| A09 | Mais de um código de plano referencial (`CVD_CODPLA`) no arquivo: listados os registros com código diferente do mais frequente (empate: o que aparece primeiro). Código vazio não conta. |

**Decisão D-1 (25/11/2026, a confirmar pelo usuário):** em A07, `CT1_CLASSE` e `CT1_NORMAL` **vazios** são alerta (toda
conta tem tipo e natureza do saldo); `CT1_NTSPED`, `CT1_BLOQ` e os campos Sim/Não vazios viram célula vazia, sem alerta
(vazio não é um código). Conta com tipo fora do domínio não entra em A02, A03 nem A08 e sai sem preenchimento.

## 5. Transformação

### 5.1 Colunas

Uma linha por registro CT1, **na ordem do arquivo**.

| Col. | Cabeçalho | Origem | Regra |
|---|---|---|---|
| A | Conta | `CT1_CONTA` | Texto |
| B | Descrição | `CT1_DESC01` | Texto, recuo = nível − 1 |
| C | Nível | calculado (5.3) | Número inteiro |
| D | Tipo | `CT1_CLASSE` | domínio `class` |
| E | Natureza do Saldo | `CT1_NORMAL` | domínio `balance` |
| F | Conta Superior | `CT1_CTASUP` | Texto |
| G | Cód. Reduzido | `CT1_RES` | Texto (zeros à esquerda preservados) |
| H | Natureza SPED | `CT1_NTSPED` | domínio `sped` |
| I | Situação | `CT1_BLOQ` | domínio `situation` |
| J, K | Bloqueio Início, Bloqueio Fim | `CT1_DTBLIN`, `CT1_DTBLFI` | Data |
| L | Dígito Controle | `CT1_DC` | Texto |
| M–Q | Aceita C. Custo, C. Custo Obrig., Aceita Item, Item Obrig., Aceita Cl. Valor | `CT1_ACCUST`, `CT1_CCOBRG`, `CT1_ACITEM`, `CT1_ITOBRG`, `CT1_ACCLVL` | domínio `yesNo` |
| R | Início Existência | `CT1_DTEXIS` | Data |
| S, T, U | Conta Referencial (ECD), Conta Ref. Superior, Cód. Plano Ref. | `CVD_CTAREF`, `CVD_CTASUP`, `CVD_CODPLA` | **Valores** do primeiro CVD da conta (sem as fórmulas da planilha manual antiga) |
| V | Descrição Complementar | `CT1_DESC02` | Texto |

### 5.2 Domínios (configuração do módulo)

Em `src/config/defaults/chart-of-accounts.json` (validados por zod): `class` 1 Sintética / 2 Analítica; `balance`
1 Devedora / 2 Credora; `situation` 1 Bloqueada / 2 Ativa; `yesNo` 1 Sim / 2 Não; `sped` 01 Ativo, 02 Passivo,
03 Patrimônio Líquido, 04 Resultado, 05 Compensação, 09 Outras (texto "01 - Ativo" etc.). O módulo não tem tela de
Configuração: roda sempre com o padrão versionado.

### 5.3 Nível

Profundidade na cadeia de `CT1_CTASUP`: sem conta superior = 1; demais = nível da superior + 1. Uma passada com
memoização; cada cadeia é percorrida uma vez e um nó revisitado no mesmo percurso fecha um ciclo (E06). Conta num ciclo,
abaixo de um ciclo ou abaixo de conta superior inexistente fica sem nível (o Resumo mostra "sem nível"; a planilha não é
gerada). Exemplo: `9 → 900 → 90001 → 90001001` dá níveis 1 a 4, embora `90001001` tenha oito dígitos.

### 5.4 Datas

`AAAAMMDD` vira número de dia sem fuso (`parseCompactDate`, `src/shared/dates.ts`) e é gravado como serial do Excel
(dia + 36526): `20030101` = 37622 = 01/01/2003, em qualquer fuso. Vazio = célula vazia. Nunca `new Date(string)`.

## 6. Saída

### 6.1 Arquivo e aba

| Item | Valor |
|---|---|
| Arquivo | `Plano_de_Contas_{nome do CSV sem extensão}[_{MM.AAAA}].xlsx` |
| Aba (única) | `Doc-01-Plano de Contas {MM.AAAA}` com período; `Doc-01-Plano de Contas` sem |
| Fonte padrão | Aptos 10 |

O período é opcional e informado na **Exportação** (validado `MM.AAAA`, mês 01 a 12), porque só afeta os nomes. Não há
aba Rastreabilidade: a especificação pede uma aba só; o SHA-256 do CSV fica no Resumo da tela.

### 6.2 Títulos

| Linha | Conteúdo | Fonte | Altura |
|---|---|---|---|
| 1 | `Plano de Contas Contábil — Protheus (CT1)` | Aptos 14, negrito, `#1F3864` | 18,75 |
| 2 | `Fonte: {nome do arquivo} (exportação CT1 + CVD). Linhas sintéticas destacadas; use os botões de nível (+/-) à esquerda para recolher a estrutura.` | Aptos 9, itálico, `#595959` | 12 |
| 3 | vazia | — | padrão |
| 4 | Cabeçalhos A–V | Aptos 10, negrito, branco; fundo `#1F3864`; centralizado h/v; quebra de texto | 30 |

### 6.3 Dados (a partir da linha 5, altura 13,5)

| Condição | Preenchimento A:V | Fonte |
|---|---|---|
| Sintética, nível 1 | `#B4C3DE` | Aptos 10, negrito |
| Sintética, nível ≥ 2 | `#DDE4F0` | Aptos 10, negrito |
| Analítica | — | Aptos 10 |
| Situação "Bloqueada" | mantém o da linha | `#C00000` **na célula I** |

Células vazias levam o estilo da coluna (o preenchimento da linha sintética cobre A:V). Estrutura de tópicos: nível do
grupo = nível − 1 (até 7, limite do Excel; acima disso, aviso), `outlineLevelRow` = maior nível usado,
`summaryBelow = 0` (botão +/- na linha sintética, acima do grupo).

| Colunas | Formato | Alinhamento |
|---|---|---|
| A, F, G, S, T | `@` | padrão |
| U | `@` | centralizado (horizontal) |
| B | Geral | **à esquerda com recuo = nível − 1** nas contas de nível ≥ 2; padrão no nível 1 |
| H, V | Geral | padrão |
| C, D, E, I, L, M–Q | Geral | centralizado h/v |
| J, K, R | `dd/mm/yyyy` | centralizado h/v |

**Decisão D-2 (25/11/2026):** o Excel (e o LibreOffice) só mostra o recuo com o alinhamento horizontal à esquerda; com
"Geral" o recuo é gravado mas não aparece. Por isso a coluna B usa "esquerda + recuo" nas contas de nível ≥ 2. Se a
planilha de referência tiver outro alinhamento, o teste de equivalência (9.4) aponta "alinhamento" na coluna B.

Códigos (A, F, G, S, T, U) são gravados como texto; o nível, como número.

### 6.4 Larguras

A 17 · B 52 · C 7 · D 11 · E 11 · F 15 · G 13 · H 21 · I 11 · J 11 · K 11 · L–Q 9 · R 12 · S 21 · T 18 · U 9 · V 34.

### 6.5 Página

A4, paisagem, ajustada à largura de uma página (`fitToPage`, `fitToWidth = 1`, `fitToHeight = 0`: o plano inteiro
numa página só ficaria ilegível), margens 0,79" (esquerda/direita) e 0,98" (superior/inferior). Sem painéis congelados
e sem autofiltro.

## 7. Telas

1. **Arquivos:** área de arrastar e soltar, só `.csv`, um arquivo.
2. **Processamento** no worker, com quatro etapas: conferência do arquivo (SHA-256 e decodificação), leitura, validação,
   transformação. A geração do XLSX tem o próprio progresso na Exportação.
3. **Resumo** (visão Reconciliação): veredito, erros bloqueantes e alertas (cada um abre a lista com linha e contas),
   totais (contas, CVD, sintéticas, analíticas, devedoras, credoras, ativas, bloqueadas, datas de bloqueio, descrição
   complementar, conta referencial), distribuição por nível (com sintéticas e analíticas) e por natureza SPED, e o
   arquivo lido (SHA-256, codificação, linhas, cabeçalhos). Indicadores-chave na faixa do topo.
4. **Exportação:** campo "Período (MM.AAAA, opcional)", só português; "Gerar planilha" desabilitado com erro bloqueante
   ou período inválido; download direto.
5. **Nova análise** encerra o worker e descarta os dados lidos (a lista de arquivos fica; troque o arquivo e analise).

## 8. Testes

- Fixture sintética (`tests/synthetic/chartOfAccountsFixture.ts`): 39 contas em windows-1252 com seis níveis, sintética
  e analítica no nível 4, contas bloqueadas com datas, `CT1_DESC02`, analítica sem CVD, sintética com CVD, CVD órfão,
  código reduzido com zeros, `–`, `Ç` e `º`, cadeia `9 → 900 → 90001 → 90001001`, cabeçalho com colunas extras e em
  ordem própria; variantes para E01–E07 e A01, A05–A07.
- Unidade: `chartOfAccountsParse`, `Validate`, `Transform`, `Workbook` (planilha relida célula a célula com
  `tests/support/xlsxStyles.ts`, determinismo byte a byte, comparador de equivalência) e `Module` (despacho do worker,
  sondagem, exportação, bloqueio). Ponta a ponta: `tests/e2e/modules.spec.ts` (Plano de contas), com a guarda de rede.

## 9. Conferência com o arquivo real (só na máquina do desenvolvedor)

`tests/local/chartOfAccounts.test.ts` (`npm run test:local`): CSV em `PLANO_CSV_REAL` ou em `local/plano-de-contas/`,
referência em `PLANO_XLSX_REF` ou no golden; pula sem o CSV. As falhas citam só campos e células, nunca valores.

- **9.2 Números de controle** (`golden-plano-de-contas.json`, chave `contagens`): registros, sintéticas/analíticas,
  devedoras/credoras, ativas/bloqueadas, níveis (e por tipo), natureza SPED, datas de bloqueio, descrição complementar,
  contagem de cada alerta e as contas de A04 e A09.
- **9.3 Amostras** (chave `amostras`): nível, tipo, preenchimento, agrupamento, recuo, cor da situação, valores de
  colunas (datas em `dd/mm/aaaa`).
- **9.4 Equivalência** (`tests/support/chartEquivalence.ts`): valores das 22 colunas em todas as linhas; por célula
  negrito, cor da fonte, preenchimento, formato de número, alinhamento horizontal e recuo; agrupamento e altura de cada
  linha; larguras. Diferença aceita: data no formato embutido 14 na referência × `dd/mm/yyyy` no módulo.

## 10. Fora de escopo

Comparação de duas versões do plano; aba de controle com totais por fórmula; aba de alertas; outros formatos de
exportação (XML, XLSX).
