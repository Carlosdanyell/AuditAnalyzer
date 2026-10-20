# Regras de negócio — Integridade da CT2 (módulo `ct2Integrity`)

Especificação do segundo módulo da plataforma (ver `docs/MODULOS.md`). A lógica foi validada manualmente em Python
contra uma extração real de um mês (números de referência em `local/golden-ct2-integrity.json`, fora do
repositório). Qualquer divergência entre esta especificação e o código é defeito no código, salvo decisão registrada
aqui. Pontos ainda abertos estão na seção 12 e **não podem ser decididos pelo agente**.

---

## 1. Objetivo

Receber a extração da tabela CT2 (lançamentos contábeis) de um período, **aglutinar** os lançamentos por documento,
lote e dia, **testar o balanceamento** em cada nível e **aspectos gerais de integridade** das linhas, e devolver um
papel de trabalho em Excel **inteiramente amarrado por fórmulas**: cada total, cada status e cada contagem de
exceção é recalculado pelo Excel a partir da aba Base, e a planilha prova sozinha que nada ficou de fora.

O módulo não presume a causa de um desbalanceamento. Ele mede, classifica e mostra os indícios (documento vizinho que
compensa, documento no limite de linhas, mesma contabilização em mais de um documento) para o analista concluir.

## 2. Arquivo de entrada

- `.xlsx` exportado da CT2 pelo Protheus (exportação de planilha da consulta/browse da tabela). Um ou mais arquivos;
  com mais de um, as linhas são unidas numa base só (ex.: meses seguidos) e a duplicidade entre arquivos é coberta
  pelo teste E1.
- Estrutura observada: uma aba (nome irrelevante, ex. `SCACKST0.XML`); linha 1 com o nome da tabela, linha 2 em
  branco, **linha 3 com os títulos**, dados a partir da linha 4; ~80 colunas. Não presumir posições.
- **Linha de cabeçalho:** a primeira linha, entre as 30 primeiras, que contém todos os títulos obrigatórios
  (comparação após `trim` e com espaços internos repetidos reduzidos a um). Os títulos vêm com espaços à direita
  (ex.: `"Data Lcto   "`).
- **Linha de detalhe:** qualquer linha após o cabeçalho com pelo menos um campo da chave do documento preenchido.
  Linhas totalmente vazias e lacunas do atributo `r` contam como **em branco**. Linha com parte da chave vazia é
  detalhe e falha o invariante CI-4.
- **Reconciliação de leitura (por arquivo):** linhas após o cabeçalho − linhas em branco = linhas de detalhe.
- SHA-256 do arquivo, CRC32 e tamanho de cada parte do ZIP: mesma rotina do módulo CFGR700.

### Colunas (localizar pelo título; aliases na configuração)

| Campo lógico | Título na extração | Alias aceito | Obrigatório |
|---|---|---|---|
| `date` | Data Lcto | CT2_DATA | sim |
| `batch` | Numero Lote | CT2_LOTE | sim |
| `subBatch` | Sub Lote | CT2_SBLOTE | sim |
| `document` | Numero Doc | CT2_DOC | sim |
| `line` | Numero Linha | CT2_LINHA | sim |
| `balanceType` | Tipo do Sld | CT2_TPSALD | sim |
| `currency` | Moeda Lancto | CT2_MOEDLC | sim |
| `entryType` | Tipo Lcto | CT2_DC | sim |
| `debitAccount` | Cta Debito | CT2_DEBITO | sim |
| `creditAccount` | Cta Credito | CT2_CREDIT | sim |
| `amount` | Valor | CT2_VALOR | sim |
| `history` | Hist Lanc | CT2_HIST | sim |
| `amountCurrency1` | Valor Moeda1 | — | não (I4 desligado se ausente) |
| `routine` | Rotina | CT2_ROTINA | não |
| `standardEntry` | Lanc Padrao | CT2_LP | não |
| `ctkSequence` | Seq CTK | CT2_SEQUEN | não (P3 desligado se ausente) |
| `manual` | Lcto Manual? | CT2_MANUAL | não |
| `origin` | Origem | CT2_ORIGEM | não |
| `companyOrigin` | Empresa Orig | CT2_EMPORI | não |
| `branchOrigin` | Filial Orig | CT2_FILORI | não |

Coluna obrigatória ausente: erro na etapa de leitura, com a lista do que faltou e do que foi encontrado. Colunas não
mapeadas são lidas e exportadas na Base como texto/número, na ordem original.

### Valores e datas

- `amount` e `amountCurrency1`: célula numérica → centavos com `Math.round(v * 100)`; texto → parse pt-BR
  (`1.234,56`) para centavos. Ilegível = CI-4.
- `date`: número serial do Excel (inteiro) ou texto `dd/mm/aaaa`. Guardar como número de dia, sem fuso. Ilegível = CI-4.
- Códigos (`batch`, `document`, `line`, `balanceType`, `currency`…) são **texto**: zeros à esquerda preservados;
  célula numérica é convertida para texto com a largura da configuração (`codeWidths`, ex.: lote 6, doc 6, linha 3).

## 3. Chaves e ordenação

- **Chave do documento** (configurável, padrão): `date + batch + subBatch + document + balanceType + currency`.
  Tipo de saldo e moeda entram porque o balanceamento só faz sentido dentro do mesmo saldo e moeda (decisão a
  confirmar, seção 12).
- **Chave da linha** (teste E1): chave do documento + `line` + `companyOrigin` + `branchOrigin` (as duas últimas só
  se existirem).
- **Ordenação da Base:** estável, pela chave da linha, com `line` na ordem de numeração da seção 4. Consequência
  obrigatória: **cada documento ocupa um bloco contíguo de linhas da Base**, cada lote um bloco contíguo de
  documentos e cada dia um bloco contíguo de lotes. Toda a amarração da planilha (seção 7) depende disso e o
  invariante CI-2 confere.
- A Base guarda a **linha de origem** (arquivo + número da linha na planilha de entrada) para rastreabilidade.

## 4. Lado do valor e numeração das linhas

| `entryType` (padrão) | Significado | Débito | Crédito |
|---|---|---|---|
| Partida Dobrada | conta débito e conta crédito na mesma linha | valor | valor |
| Debito | linha só a débito | valor | 0 |
| Credito | linha só a crédito | 0 | valor |
| Cont.Hist | continuação de histórico; sem valor | 0 | 0 |

Os textos vêm da configuração (`entryTypes`); extrações com o código CT2_DC (`3`, `1`, `2`, `4`) usam o mapa
alternativo. Tipo não reconhecido: linha entra com débito e crédito 0 e falha o teste I1.

**Numeração das linhas:** três caracteres. A sequência observada é `001`…`999` e, em seguida, `A00`. A regra completa
depois de `A00` (função Soma1 do Protheus) está pendente (seção 12); até lá, o ordinal vale 1–999 para as linhas
numéricas e as alfanuméricas seguem a ordem de leitura depois de 999.

## 5. Aglutinação

| Nível | Chave | Medidas |
|---|---|---|
| Documento | seção 3 | linhas, débito, crédito, diferença, linhas com exceção, 1ª linha (rotina, LP, Seq CTK, histórico), última linha, ordinal da última linha, Seq CTK distintos |
| Lote | `date + batch + subBatch + balanceType + currency` | documentos, linhas, débito, crédito, diferença, documentos desbalanceados |
| Dia | `date + balanceType + currency` | lotes, documentos, linhas, débito, crédito, diferença, dia não útil |
| Total | extração inteira | todas as anteriores |

Somas em centavos inteiros. Diferença = débito − crédito.

## 6. Testes

Todo teste tem código, nível, severidade e regra; liga/desliga e severidade vêm da configuração. **Erro** e
**Alerta** são achados da análise (não bloqueiam a exportação); **Info** é perfil. Nenhum teste altera ou exclui
linhas.

### 6.1 Balanceamento

| Código | Nível | Severidade | Regra |
|---|---|---|---|
| B1 | Documento | Erro | \|débito − crédito\| > tolerância (padrão 0,00) |
| B2 | Lote | Erro | idem, no lote |
| B3 | Dia | Erro | idem, no dia |
| B4 | Documento | Info (diagnóstico de B1) | documento com B1 cuja diferença é compensada exatamente pelo documento **seguinte ou anterior** do mesmo lote (soma das diferenças = 0); resultado "Compensa doc NNNNNN" ou "Sem compensação" |
| B5 | Documento | Alerta | documento com B1 e **sem** compensação adjacente (B4 = "Sem compensação") |

### 6.2 Consistência da linha

| Código | Severidade | Regra (exceção quando verdadeira) |
|---|---|---|
| I1 | Erro | tipo de lançamento incoerente com as contas: Partida Dobrada sem as duas contas; Debito sem conta débito ou com conta crédito; Credito sem conta crédito ou com conta débito; Cont.Hist com conta ou com valor ≠ 0; tipo não reconhecido |
| I2 | Erro | linha com valor (tipo ≠ Cont.Hist) e valor ≤ 0 |
| I3 | Alerta | Partida Dobrada com a mesma conta no débito e no crédito |
| I4 | Alerta | moeda = moeda local da configuração e `amount` ≠ `amountCurrency1` |
| I5 | Alerta | histórico vazio (após `trim`) |

### 6.3 Integridade estrutural

| Código | Nível | Severidade | Regra |
|---|---|---|---|
| E1 | Linha | Erro | chave da linha igual à da linha anterior na Base ordenada (duplicidade; a 2ª e seguintes são exceção) |
| E2 | Documento | Info | lacuna na numeração: ordinal da última linha ≠ quantidade de linhas do documento |
| E3 | Linha | Alerta | tipo de saldo ≠ esperado (parâmetro) |
| E4 | Linha | Alerta | moeda ≠ esperada (parâmetro) |
| E5 | Linha | Erro | data fora do período informado (parâmetros data inicial e final) |
| E6 | Dia | Info | dia não útil (sábado, domingo ou feriado da configuração da plataforma) |

### 6.4 Perfil (Info)

| Código | Regra |
|---|---|
| P1 | linhas, débito e crédito por rotina e por lançamento padrão |
| P2 | linhas e valor por "Lcto Manual?" (descrições dos códigos na configuração, seção 12) |
| P3 | documento com mais de um Seq CTK, e Seq CTK presente em mais de um documento |
| P4 | documento com quantidade de linhas ≥ limite de linhas por documento (parâmetro) e os 10 maiores documentos |

### 6.5 Parâmetros da execução (informados na tela antes de processar; gravados na Critérios)

| Parâmetro | Padrão |
|---|---|
| Data inicial / final do período | 1º e último dia do mês da menor data lida (editável) |
| Tipo de saldo esperado | `1` |
| Moeda esperada / moeda local | `01` / `01` |
| Tolerância de balanceamento (R$) | 0,00 |
| Limite de linhas por documento | 1.000 (observado; parâmetro do Protheus a confirmar, seção 12) |

## 7. Planilha exportada — amarração por fórmulas

### 7.1 Princípio

Os **dados** de entrada ficam como valores na aba Base (evidência). **Tudo o que é derivado é fórmula**, em cadeia:

```
Criterios (parâmetros, nomes definidos)
      │
Base (valores + colunas de teste por fórmula)
      │  SUM/ROWS sobre o bloco contíguo do documento
Documentos ──► Lotes ──► Dias ──► Resumo
      │                              ▲
      └──► Excecoes (confirmação por INDEX) ┘   Perfil (COUNTIF/SUMIF na Base) ┘
```

Regras:
- **Proibido SUMIFS/COUNTIFS sobre a coluna inteira por linha de agregação** (custo linhas × documentos; com ~40 mil
  linhas e ~5 mil documentos o recálculo não termina em tempo razoável). A agregação usa **intervalos de bloco**
  calculados pelo motor: `=SUM(Base!$X$a:$X$b)`, `=ROWS(Base!$A$a:$A$b)`. O motor grava `a` e `b` também como valores
  visíveis (colunas "Linha inicial na Base" e "Linha final na Base"), para o revisor conferir o bloco.
- Fórmulas de linha da Base só podem ler a própria linha, a linha anterior (E1) e nomes definidos: custo O(1).
- Toda fórmula usa as funções aceitas pelo `tests/support/xlsxEval.ts`. As novas (`ROWS`, `COUNTA`, `WEEKDAY`,
  `COUNTIF`, `SUMIF`) entram no avaliador na Fase 11, com testes.
- Valores calculados pela ferramenta que **não** têm fórmula (lista abaixo) aparecem com cabeçalho cinza e a nota
  "calculado pela ferramenta" na Critérios.

### 7.2 Nomes definidos (aba Criterios)

`P_DATA_INI`, `P_DATA_FIM`, `P_SALDO`, `P_MOEDA`, `P_MOEDA_LOCAL`, `P_TOL`, `P_LIMITE_LINHAS`, `P_TIPO_PD`,
`P_TIPO_DEB`, `P_TIPO_CRED`, `P_TIPO_HIST`, `P_FERIADOS` (intervalo). Células de parâmetro com texto azul e
preenchimento de entrada; alterar um parâmetro recalcula testes e status. A estrutura (blocos, ordenação) não muda
com parâmetros.

### 7.3 Abas

| # | Aba (pt / en) | Conteúdo |
|---|---|---|
| 1 | Resumo / Summary | indicadores, matriz de amarração, quadro de testes, documentos desbalanceados, conclusão automática |
| 2 | Criterios / Criteria | objetivo, fonte, parâmetros (nomes definidos), regra de cada teste, colunas por fórmula × calculadas, limitações, glossário |
| 3 | Documentos / Documents | uma linha por documento |
| 4 | Lotes / Batches | uma linha por lote |
| 5 | Dias / Days | uma linha por dia |
| 6 | Excecoes / Exceptions | uma linha por ocorrência de teste com severidade Erro ou Alerta (Info fica nas abas de nível) |
| 7 | Perfil / Profile | P1, P2, P3, P4 |
| 8 | Base / Base | extração ordenada + colunas de teste |
| 9 | Rastreabilidade / Traceability | versão, data, configuração (SHA-256 e diferenças), arquivos (nome, tamanho, SHA-256, cabeçalho encontrado, mapeamento de colunas, reconciliação de leitura), parâmetros, invariantes |

### 7.4 Base

Colunas, nesta ordem: `Arquivo`, `Linha na origem`, todas as colunas da extração (valores, títulos sem os espaços à
direita), e as colunas de fórmula (cabeçalho cinza, título explícito, resultado Sim/Não):

| Coluna | Fórmula (linha r; nomes das colunas de dados entre chaves) |
|---|---|
| Débito | `=IF(OR({Tipo}=P_TIPO_PD,{Tipo}=P_TIPO_DEB),{Valor},0)` |
| Crédito | `=IF(OR({Tipo}=P_TIPO_PD,{Tipo}=P_TIPO_CRED),{Valor},0)` |
| I1 Exceção? | `=IF(IF({Tipo}=P_TIPO_PD,AND({Deb}<>"",{Cred}<>""),IF({Tipo}=P_TIPO_DEB,AND({Deb}<>"",{Cred}=""),IF({Tipo}=P_TIPO_CRED,AND({Deb}="",{Cred}<>""),IF({Tipo}=P_TIPO_HIST,AND({Deb}="",{Cred}="",{Valor}=0),FALSE)))),"Não","Sim")` |
| I2 Exceção? | `=IF(AND({Tipo}<>P_TIPO_HIST,{Valor}<=0),"Sim","Não")` |
| I3 Exceção? | `=IF(AND({Tipo}=P_TIPO_PD,{Deb}={Cred}),"Sim","Não")` |
| I4 Exceção? | `=IF(AND({Moeda}=P_MOEDA_LOCAL,ROUND({Valor}-{VlrMoeda1},2)<>0),"Sim","Não")` |
| I5 Exceção? | `=IF(TRIM({Hist})="","Sim","Não")` |
| E1 Exceção? | `=IF(AND({chave da linha r} = {chave da linha r−1}, campo a campo),"Sim","Não")` (1ª linha de dados: "Não") |
| E3 Exceção? | `=IF({Saldo}<>P_SALDO,"Sim","Não")` |
| E4 Exceção? | `=IF({Moeda}<>P_MOEDA,"Sim","Não")` |
| E5 Exceção? | `=IF(OR({Data}<P_DATA_INI,{Data}>P_DATA_FIM),"Sim","Não")` |
| Exceções na linha | `=COUNTIF({I1}r:{E5}r,"Sim")` |

Teste desligado na configuração: a coluna não é gerada e o teste sai do quadro do Resumo.

### 7.5 Documentos

Valores (chave): data, lote, sub-lote, documento, tipo de saldo, moeda; **valores do motor**: linha inicial e final
na Base, ordinal da última linha, Seq CTK distintos, "Seq CTK em outro documento?". Fórmulas:

| Coluna | Fórmula |
|---|---|
| Linhas | `=ROWS(Base!$A$a:$A$b)` |
| Débito / Crédito | `=SUM(Base!{Débito}$a:{Débito}$b)` / idem Crédito |
| Diferença | `=ROUND(Débito−Crédito,2)` |
| B1 Desbalanceado? | `=IF(ABS(Diferença)>P_TOL,"Sim","Não")` |
| B4 Compensação adjacente | `=IF(B1="Não","",IF(AND(mesmo lote na linha seguinte,ROUND(Dif+Dif_seguinte,2)=0),"Compensa doc "&Doc_seguinte,IF(AND(mesmo lote na linha anterior,ROUND(Dif+Dif_anterior,2)=0),"Compensa doc "&Doc_anterior,"Sem compensação")))` |
| B5 Exceção? | `=IF(B4="Sem compensação","Sim","Não")` |
| E2 Lacuna na numeração? | `=IF(OrdinalÚltima<>Linhas,"Sim","Não")` |
| P4 Atingiu limite de linhas? | `=IF(Linhas>=P_LIMITE_LINHAS,"Sim","Não")` |
| Linhas com exceção | `=COUNTIF(Base!{Exceções na linha}$a:$b,">0")` |
| Rotina, LP, Seq CTK, Histórico (1ª linha) | `=IF(Base!{col}a="","",Base!{col}a)` |

"Mesmo lote" compara data, lote, sub-lote, tipo de saldo e moeda das duas linhas.

### 7.6 Lotes e Dias

- **Lotes:** linha inicial/final em Documentos (valores); `Documentos =ROWS(Documentos!$A$x:$A$y)`;
  `Linhas`, `Débito`, `Crédito` = `SUM` do bloco em Documentos; `Diferença`; `B2 Desbalanceado?`;
  `Documentos desbalanceados =COUNTIF(Documentos!{B1}x:{B1}y,"Sim")`.
- **Dias:** mesmo esquema sobre Lotes; `Lotes =ROWS(...)`; `B3 Desbalanceado?`;
  `E6 Dia não útil? =IF(OR(WEEKDAY(Data,2)>5,COUNTIF(P_FERIADOS,Data)>0),"Sim","Não")`.

### 7.7 Exceções

Uma linha por ocorrência (valores): código, nível, severidade, aba de origem, linha na aba de origem, chave
(data, lote, sub-lote, documento, linha), valor, descrição. Coluna de fórmula **"Confirmada na origem?"**:
`=IF(INDEX(<aba>!<coluna do teste>:<coluna>, <linha>)="Sim","Sim","Não")`, uma fórmula por linha apontando para a
coluna do teste na aba de origem (Base para linha; Documentos, Lotes, Dias para os demais). Ordenação: severidade,
código, chave.

### 7.8 Resumo

1. **Indicadores:** documentos, linhas, lotes, dias, débito, crédito, diferença líquida, documentos desbalanceados,
   exceções Erro, exceções Alerta — todos por fórmula sobre Dias/Documentos/Excecoes.
2. **Matriz de amarração** (cada célula fórmula; diferença = 0 → "OK", senão "Verificar"):

   | Nível | Linhas | Documentos | Lotes | Débito | Crédito |
   |---|---|---|---|---|---|
   | Base | `COUNTA` da chave | — | — | `SUM` Débito | `SUM` Crédito |
   | Documentos | `SUM` Linhas | `ROWS` | — | `SUM` | `SUM` |
   | Lotes | `SUM` | `SUM` Documentos | `ROWS` | `SUM` | `SUM` |
   | Dias | `SUM` | `SUM` | `SUM` Lotes | `SUM` | `SUM` |
   | **Ferramenta** (valor do motor) | valor | valor | valor | valor | valor |
   | Diferenças (cada nível − Base; Ferramenta − Base) | | | | | |

   A linha Ferramenta prova que o Excel recalculou o mesmo que o motor; é a única linha de valores do quadro.
3. **Quadro de testes:** código, teste, nível, severidade, ocorrências por fórmula (`COUNTIF` na coluna do teste),
   ocorrências em Excecoes (`COUNTIF` do código), ocorrências pela ferramenta (valor), "confirmadas na origem"
   (`COUNTIFS` código + "Sim"), conferência (`"Confere"` quando as quatro contagens são iguais), status
   (`OK` / `Verificar` / `Info`). Info não vai para Excecoes: as duas colunas de Excecoes ficam "—".
4. **Documentos desbalanceados:** até 50 linhas com `INDEX` sobre Documentos (lista gerada pelo motor como números de
   linha, com tratamento de vazio); nota com o total quando passar de 50.
5. **Conclusão automática** (texto montado pelo motor, na língua da exportação), com as frases condicionadas:
   balanceamento por nível; quantos desbalanceados têm compensação adjacente; quantos documentos atingiram o limite
   de linhas; testes com Erro. Sem juízo de causa: "indícios" e "a confirmar pelo analista".

### 7.9 Limites

- Excel: 1.048.576 linhas por aba. Base com mais linhas que isso: exportação bloqueada (CI-8), com mensagem.
- Tempo de recálculo: medir na Fase 11 (`docs/MEDICOES.md`) com 40 mil, 300 mil e 1 milhão de linhas sintéticas.
  Se 1 milhão não for viável, **parar e discutir** (seção 12) — não trocar fórmula por valor sem decisão.

## 8. Invariantes (verificados a cada execução)

| Código | Regra | Bloqueia exportação |
|---|---|---|
| CI-1 | Reconciliação de leitura por arquivo (seção 2); CRC32 e tamanho do ZIP | sim |
| CI-2 | Base ordenada pela chave da linha; cada documento em um único bloco contíguo; blocos de documento cobrem todas as linhas sem sobreposição; idem lotes sobre documentos e dias sobre lotes | sim |
| CI-3 | Σ débito e Σ crédito (centavos) iguais em Base, Documentos, Lotes, Dias e total | sim |
| CI-4 | Valores legíveis: chave completa, data válida, valor legível em toda linha de detalhe | sim |
| CI-5 | Para cada teste, ocorrências pelas marcas de linha/nível = linhas da Excecoes (Erro/Alerta) | sim |
| CI-6 | Contagens: documentos = chaves distintas; lotes e dias idem | sim |
| CI-7 | Exportação: nenhuma data zero ou anterior a 1901; nenhuma mesclagem sobreposta (mesmas regras 9 e 10 do CFGR700) | sim |
| CI-8 | Base cabe numa aba do Excel | sim |
| CI-9 | Alerta: coluna opcional ausente (lista dos testes desligados por isso) | não |
| CI-10 | Alerta: período informado não cobre todas as datas lidas (as fora do período viram E5) | não |

Exportação com invariante bloqueante falhando: mesma regra do CFGR700 (confirmação explícita registrada no Resumo e
na Rastreabilidade).

## 9. Tela do módulo

Segue `docs/INTERFACE.md` (arquivos, processamento, reconciliação, tabelas, exportação, configuração) com:

- **Parâmetros** antes de processar (seção 6.5), com o período pré-preenchido depois da leitura do cabeçalho e das
  datas mínima e máxima.
- **Painel:** indicadores; matriz de amarração com OK/Verificar; quadro de testes (cada número abre a tabela filtrada:
  Excecoes pelo código, ou Documentos/Lotes/Dias pelo status); documentos desbalanceados com a compensação
  adjacente; 10 maiores documentos com o limite de linhas; perfil por rotina.
- **Tabelas:** Documentos, Lotes, Dias, Exceções, Base (com as colunas de teste), virtualizadas e paginadas no worker.
- **Exportação:** idioma pt/en; nome sugerido `CT2_Integridade_<AAAA-MM>_<data da execução>.xlsx`.

## 10. Limitações a declarar (Critérios e painel)

- A análise cobre só as linhas presentes na extração; lançamentos excluídos antes da extração não aparecem (ver o
  módulo CFGR700).
- A amarração depende da ordenação da Base; reordenar ou inserir linhas na Base quebra os blocos e a matriz de
  amarração passa a mostrar "Verificar".
- B4 e P4 são indícios: compensação adjacente e limite de linhas não provam a causa do desbalanceamento.
- E2 vale só para a numeração 001–999 enquanto a regra após A00 não estiver confirmada.

## 11. Testes da ferramenta

- **Sintéticos (versionados):** gerador de extração CT2 `.xlsx` com o layout real (linha de título, linha em branco,
  cabeçalho com espaços à direita, ~80 colunas, códigos como texto e como número). Um caso por regra: documento
  balanceado; par desbalanceado que se compensa (documento com 1.000 linhas `001`–`999` + `A00` e continuação no
  seguinte); desbalanceado sem compensação; I1 em cada variação; I2; I3; I4; I5; E1 dentro do arquivo e entre dois
  arquivos; E2; E3; E4; E5; E6 com sábado e feriado; Seq CTK em dois documentos; coluna opcional ausente; coluna
  obrigatória ausente; chave incompleta; valor ilegível.
- **Planilha:** `xlsxEval` avalia todas as fórmulas da exportação sintética e confere: matriz de amarração toda OK,
  quadro de testes "Confere", cada status de Documentos/Lotes/Dias = motor, Excecoes toda "Confirmada"; alterar um
  parâmetro (ex.: `P_TOL`) no avaliador muda os status como o motor muda; determinismo byte a byte.
- **Locais (fora do git):** a extração real em `local/` e `local/golden-ct2-integrity.json` com documentos, linhas,
  débito, crédito, desbalanceados e a compensação esperada.
- **Ponta a ponta:** escolher o módulo, carregar o sintético, conferir painel e exportação, sem requisição externa.

## 12. Pendências (decidir com o usuário antes de implementar o item)

1. **Limite de linhas por documento:** 1.000 observado na extração real; confirmar com a TI o parâmetro do Protheus
   (provável `MV_NUMLIN`) e se varia por rotina.
2. **Numeração após `A00`:** regra da função Soma1 (`A01`…`A99`, `B00`…? ou `A0A`?). Necessária para E2 completo.
3. **"Lcto Manual?":** significado dos códigos (observados `1` e `2`) para P2.
4. **Usuário em "Origem":** regra para extrair o usuário do texto (aparece no fim do campo em lançamentos de rotina)
   — se for usado em P2.
5. **Chave do documento com tipo de saldo e moeda** (seção 3): confirmar.
6. **Teto do modo amarrado:** resultado da medição da seção 7.9.

## 13. Decisões registradas

- 20/10/2026 — Módulo criado a partir da análise manual de uma extração mensal (validação em Python): aglutinação
  por documento, prova de compensação adjacente e controles de integridade; usuário pediu ferramenta geral de
  integridade (não focada no limite de linhas) e planilha **toda amarrada por fórmulas**.
- 20/10/2026 — Agregação por blocos contíguos (`SUM`/`ROWS`) em vez de `SUMIFS` por linha: na validação manual, a
  versão com `SUMIFS` sobre a base inteira (dezenas de milhares de fórmulas sobre uma base de dezenas de milhares de
  linhas) não recalculou em quase 30 minutos no LibreOffice; a versão por blocos recalculou a pasta em ~1 minuto.
