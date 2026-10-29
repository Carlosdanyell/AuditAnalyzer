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
- **Linha de detalhe:** qualquer linha após o cabeçalho com algum valor (célula não vazia depois de tirar os espaços
  das pontas, inclusive em coluna não mapeada, ou referência inválida às strings compartilhadas). Linhas totalmente
  vazias e lacunas do atributo `r` contam como **em branco**. Linha com parte da chave vazia, ou sem nenhum campo da
  chave, é detalhe e falha o invariante CI-4 (regra conservadora, decisão de 21/10/2026): nenhuma linha com conteúdo
  sai da conta sem aviso.
- **Abas:** com várias abas, vale a que tem o cabeçalho nas primeiras linhas; duas abas com o cabeçalho é erro de
  leitura, assim como coluna mapeada repetida (título ou alias de um campo, obrigatório ou opcional, em duas colunas:
  não haveria como escolher qual vale). Coluna obrigatória ausente: erro
  com a lista do que faltou e dos títulos encontrados.
- **Valores fora das colunas:** valor numa coluna sem título (ou além da coluna 256) não entra na base e falha CI-1.
  Célula só com formatação ou só com espaços não é valor: as células além da coluna 256 são lidas como as demais
  (string compartilhada, string inline, fórmula) e julgadas pelo texto. XML malformado (célula sem `</c>`) é erro
  de leitura com o nome do arquivo e da aba.
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
mapeadas são lidas e exportadas na Base como texto/número, na ordem original; um título não mapeado repetido ganha o
número da ocorrência entre colchetes (`Filial [2]`), o mesmo em todos os arquivos, para que a enésima ocorrência
se una entre eles (próximo número livre no caso improvável de o arquivo já ter uma coluna com esse título). Com vários arquivos, as colunas são unidas pelo título, com alerta quando os
conjuntos diferem; coluna opcional ausente gera alerta (os testes que dependem dela ficam desligados, CI-9). Campos
da chave do documento precisam ser colunas obrigatórias (a configuração recusa outro caso).

### Valores e datas

- `amount` e `amountCurrency1`: célula numérica → centavos com `Math.round(v * 100)`; texto → parse pt-BR
  (`1.234,56`: sinal de menos opcional, milhares com ponto, até duas casas depois da vírgula; outro formato nunca é
  adivinhado). Ilegível = CI-4. `amount` vazio vale 0 só na continuação de histórico; nas demais linhas, CI-4.
  `amountCurrency1` vazio fica sem valor; ilegível gera alerta (a linha fica fora do teste I4).
- `date`: número serial do Excel inteiro (sistema 1900 ou 1904, conforme a pasta), entre 1932 e 2067, ou texto
  `dd/mm/aaaa`. Guardar como número de dia, sem fuso. Serial com fração, data inexistente ou fora do intervalo = CI-4.
- Códigos (`batch`, `document`, `line`, `balanceType`, `currency`…) são **texto**: zeros à esquerda preservados, espaços
  das pontas retirados; célula numérica é convertida para texto com a largura da configuração (`codeWidths`, ex.:
  lote 6, doc 6, linha 3). Célula numérica que não é inteiro = CI-4. Linha, tipo de saldo ou moeda vazios = CI-4.
  Os demais códigos (contas, origem) não são completados com zeros.

## 3. Chaves e ordenação

- **Chave do documento** (configurável, padrão): `date + batch + subBatch + document`. Tipo de saldo e moeda **não**
  fazem parte da chave (decisão de 20/10/2026, seção 13).
- **Segmento:** `balanceType + currency`. Tipo de saldo e moeda ficam em colunas próprias e separam a análise: todo
  balanceamento (documento, lote, dia) é medido **dentro de cada segmento**, nunca somando moedas ou tipos de saldo
  diferentes. Um documento com linhas em dois segmentos (ex.: moeda `01` e `02`) aparece uma vez em cada segmento,
  com o próprio balanceamento. Na extração mais comum (um tipo de saldo e uma moeda) existe um único segmento.
- **Chave da linha** (teste E1): segmento + chave do documento + `line` + `companyOrigin` + `branchOrigin` (as duas
  últimas só se existirem). O segmento entra para que a mesma linha em duas moedas não seja apontada como duplicada.
- **Ordenação da Base:** estável, pela chave da linha completa: segmento, chave do documento, `line` (na ordem de
  numeração da seção 4), `companyOrigin` e `branchOrigin`; empates na ordem de leitura (arquivo, linha de origem).
  Textos comparados pelas unidades de código, sem regras de idioma (`0` < `9` < `A` < `a`); datas pelo número do dia.
  Assim linhas com a mesma chave ficam adjacentes, como o teste E1 exige. Consequência obrigatória: **cada documento
  de um segmento ocupa um bloco contíguo de linhas da Base**, cada lote um bloco contíguo de documentos e cada dia um
  bloco contíguo de lotes, sempre dentro do segmento. Toda a amarração da planilha (seção 7) depende disso e o
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

**Numeração das linhas:** três caracteres. A sequência observada é `001`…`999` e, em seguida, `A00`. O usuário
acredita que a sequência continua `A00`, `A01`, …; a regra depois de `A00` (função Soma1 do Protheus) ainda não está
confirmada (seção 12). Na ordenação, as linhas seguem a **ordem do texto** (decisão de 21/10/2026): `001` < … <
`999` < `A00` < `A01` < … < `A99` < `B00`. O ordinal numérico (E2) vale só para `001`–`999`.

## 5. Aglutinação

| Nível | Chave | Medidas |
|---|---|---|
| Documento | segmento + chave do documento (seção 3) | linhas, débito, crédito, diferença, linhas com exceção, 1ª linha (rotina, LP, Seq CTK, histórico), última linha, ordinal da última linha, Seq CTK distintos |
| Lote | segmento + `date + batch + subBatch` | documentos, linhas, débito, crédito, diferença, documentos desbalanceados |
| Dia | segmento + `date` | lotes, documentos, linhas, débito, crédito, diferença, dia não útil |
| Segmento | `balanceType + currency` | dias, lotes, documentos, linhas, débito, crédito, diferença |
| Total | extração inteira | contagens e somas usadas só na amarração (seção 7) |

Somas em centavos inteiros. Diferença = débito − crédito. Valores de segmentos diferentes (moedas ou tipos de saldo)
não são somados para fins de balanceamento nem de indicadores de valor; o total da extração serve só para provar que
nada ficou de fora (matriz de amarração). Detalhe da apresentação por segmento: Fase 11.

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
| P2 | linhas e valor por "Lcto Manual?", com a mesma regra do módulo CFGR700 (`REGRAS_CFGR700.md`, seção 5, "origem"): `1` = Manual, `2` = Automático, qualquer outro valor ou vazio = Não identificado; códigos na configuração |
| P3 | documento com mais de um Seq CTK, e Seq CTK presente em mais de um documento |
| P4 | documento com quantidade de linhas ≥ limite de linhas por documento (parâmetro `MV_NUMLIN` do Protheus) e os 10 maiores documentos |

### 6.5 Parâmetros da execução (informados na tela antes de processar; gravados na Critérios)

| Parâmetro | Padrão |
|---|---|
| Data inicial / final do período | todos os meses lidos: 1º dia do mês da menor data e último dia do mês da maior data lida (editável; decisão de 29/10/2026) |
| Tipo de saldo esperado | `1` |
| Moeda esperada / moeda local | `01` / `01` |
| Tolerância de balanceamento (R$) | 0,00 |
| Limite de linhas por documento | 1.000 (valor do parâmetro `MV_NUMLIN` do Protheus na extração observada; pode ser aumentado no Protheus, e então o parâmetro da execução acompanha) |

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

Valores: segmento (tipo de saldo, moeda) e chave (data, lote, sub-lote, documento); **valores do motor**: linha inicial e final
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

"Mesmo lote" compara o segmento (tipo de saldo e moeda) e data, lote e sub-lote das duas linhas: a compensação
adjacente nunca cruza segmentos.

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
   exceções Erro, exceções Alerta — todos por fórmula sobre Dias/Documentos/Excecoes. Débito, crédito e diferença
   aparecem por segmento (seção 5); contagens podem ter também o total da extração.
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
| CI-1 | Reconciliação de leitura por arquivo (seção 2), nenhum valor fora das colunas com título; SHA-256, CRC32 e tamanho de cada entrada do ZIP | sim |
| CI-2 | Base ordenada por segmento e chave da linha; cada documento de um segmento em um único bloco contíguo; blocos de documento cobrem todas as linhas sem sobreposição; idem lotes sobre documentos e dias sobre lotes | sim |
| CI-3 | Σ débito e Σ crédito (centavos) iguais em Base, Documentos, Lotes, Dias e total | sim |
| CI-4 | Valores legíveis em toda linha de detalhe: chave completa, linha, tipo de saldo e moeda preenchidos, data válida, valor legível (vazio só em continuação de histórico), códigos numéricos inteiros, referências de string válidas. A tela lista as 5 primeiras linhas de origem com problema de cada arquivo | sim |
| CI-5 | Para cada teste, ocorrências pelas marcas de linha/nível = linhas da Excecoes (Erro/Alerta) | sim |
| CI-6 | Contagens: documentos = pares segmento + chave distintos; lotes e dias idem | sim |
| CI-7 | Exportação: nenhuma data zero ou anterior a 1901; nenhuma mesclagem sobreposta (mesmas regras 9 e 10 do CFGR700) | sim |
| CI-8 | Base cabe numa aba do Excel | sim |
| CI-9 | Alerta: coluna opcional ausente (lista dos testes desligados por isso) | não |
| CI-10 | Alerta: período informado não cobre todas as datas lidas (as fora do período viram E5) | não |

Exportação com invariante bloqueante falhando: mesma regra do CFGR700 (confirmação explícita registrada no Resumo e
na Rastreabilidade).

**Como são conferidos (Fase 10, `src/worker/modules/ct2Integrity/checks.ts`):** cada invariante reconta por um
caminho próprio. CI-3 soma as linhas na ordem de leitura (sem a ordem da base) e compara com a base ordenada, os
documentos, os lotes, os dias, os segmentos e os totais da leitura. CI-5 conta, para cada teste de Erro ou Alerta, as
marcas do nível e as linhas da lista de exceções. CI-6 conta as chaves distintas (segmento + chave) com uma tabela de
dispersão, sem a ordem da base, e compara com os blocos e com as contagens da leitura. CI-9 lista as colunas
opcionais ausentes de todos os arquivos (teste desligado) e de parte deles (essas linhas ficam fora do teste ou com o
campo vazio). CI-10 conta as linhas com data válida fora do período.

**Detalhes da aplicação dos testes (Fase 10):** valor ilegível (CI-4) conta 0 nas somas e fica fora de I2 e da parte
de valor de I1 e I4; data inválida fica fora de E5 e o dia sem data válida, de E6; Seq CTK vazio não é sequência
(P3); grupo de rotina ou de lançamento padrão vazio é um grupo próprio (P1); B4 só diagnostica documentos com B1, e
B5 só existe com B4 ligado (a configuração recusa B4 sem B1 e B5 sem B4). O teste ligado cuja coluna opcional falta em
todos os arquivos aparece como "sem a coluna" no quadro de testes.

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
- O módulo não identifica o usuário que fez o lançamento (seção 12, item 4); a análise por usuário é do módulo
  CFGR700.

## 11. Testes da ferramenta

- **Sintéticos (versionados):** gerador de extração CT2 `.xlsx` com o layout real (linha de título, linha em branco,
  cabeçalho com espaços à direita, ~80 colunas, códigos como texto e como número). Um caso por regra: documento
  balanceado; par desbalanceado que se compensa (documento com 1.000 linhas `001`–`999` + `A00` e continuação no
  seguinte); desbalanceado sem compensação; I1 em cada variação; I2; I3; I4; I5; E1 dentro do arquivo e entre dois
  arquivos; E2; E3; E4; E5; E6 com sábado e feriado; Seq CTK em dois documentos; documento com linhas em dois
  segmentos (moedas `01` e `02`, mesmas linhas, cada segmento balanceado e sem E1); coluna opcional ausente; coluna
  obrigatória ausente; chave incompleta; valor ilegível.
- **Planilha:** `xlsxEval` avalia todas as fórmulas da exportação sintética e confere: matriz de amarração toda OK,
  quadro de testes "Confere", cada status de Documentos/Lotes/Dias = motor, Excecoes toda "Confirmada"; alterar um
  parâmetro (ex.: `P_TOL`) no avaliador muda os status como o motor muda; determinismo byte a byte.
- **Locais (fora do git):** as extrações reais em `local/ct2/` e `local/ct2/golden-ct2-integrity.json`
  (`tests/local/ct2Golden.test.ts`, formato no cabeçalho do teste): linhas, documentos e, por segmento, linhas,
  documentos, débito e crédito (Fase 9); desbalanceados, diferença e documento que compensa (B1 e B4, Fase 10). Medição de tempo
  e memória com extrações sintéticas grandes: `MEDIR_CT2=1 npm run test:local` (`tests/local/ct2Measure.test.ts`;
  os arquivos são gerados uma vez na pasta temporária do sistema).
- **Ponta a ponta:** escolher o módulo, carregar o sintético, conferir painel e exportação, sem requisição externa.
- **Motor (Fase 10, versionado):** `tests/synthetic/ct2EngineFixture.ts` tem um caso por regra e a lista exata de
  exceções esperadas, os resultados de B4 e dos testes Info; `tests/unit/ct2Analysis.test.ts` confere também a
  tolerância, testes desligados, severidade trocada, duplicidade entre arquivos, colunas opcionais ausentes e
  invariantes que falham numa análise adulterada.

## 12. Pendências (decidir com o usuário antes de implementar o item)

Situação em 20/10/2026 (decisões na seção 13):

1. **Limite de linhas por documento — decidido.** O parâmetro é o `MV_NUMLIN` do Protheus e vale por **documento**
   (P4). Ainda em aberto, sem bloquear: se o limite varia por rotina (o parâmetro da execução é editável).
2. **Numeração após `A00` — pendente.** O usuário acredita que segue `A00`, `A01`, …; confirmar `A00`–`A99` e o que
   vem depois de `A99` (função Soma1). Necessária para E2 completo; até lá, E2 vale para 001–999 (seções 4 e 10). A
   ordenação já está decidida: ordem do texto (seção 4).
   Com o `MV_NUMLIN` aumentado, linhas depois de `A00` passam a aparecer: um bom momento para obter a evidência.
3. **"Lcto Manual?" — decidido.** Mesma regra e mesmos códigos configuráveis do módulo CFGR700 (P2).
4. **Usuário em "Origem" — fora do escopo.** O usuário avalia que a CT2 não traz o nome de usuário; o texto do campo
   em lançamentos de rotina pode trazer algo no fim, mas o módulo não o interpreta e P2 não usa usuário.
5. **Chave do documento com tipo de saldo e moeda — decidido.** A chave não inclui tipo de saldo e moeda; os dois
   formam o segmento, que separa a análise (seção 3).
6. **Teto do modo amarrado — pendente.** Resultado da medição da seção 7.9 (Fase 11).

## 13. Decisões registradas

- 20/10/2026 — Módulo criado a partir da análise manual de uma extração mensal (validação em Python): aglutinação
  por documento, prova de compensação adjacente e controles de integridade; usuário pediu ferramenta geral de
  integridade (não focada no limite de linhas) e planilha **toda amarrada por fórmulas**.
- 20/10/2026 — Agregação por blocos contíguos (`SUM`/`ROWS`) em vez de `SUMIFS` por linha: na validação manual, a
  versão com `SUMIFS` sobre a base inteira (dezenas de milhares de fórmulas sobre uma base de dezenas de milhares de
  linhas) não recalculou em quase 30 minutos no LibreOffice; a versão por blocos recalculou a pasta em ~1 minuto.
- 20/10/2026 — Pendências da seção 12, respondidas pelo usuário:
  - **Limite de linhas:** o `MV_NUMLIN` do Protheus limita as linhas do **documento** e pode ser aumentado no
    Protheus para evitar o desbalanceamento causado por documentos que passam do limite (1.000 na extração
    observada). P4 mede por documento; o limite é parâmetro da execução.
  - **Numeração:** o usuário acredita que segue `A00`, `A01`, …; continua pendente de confirmação (item 2).
  - **"Lcto Manual?":** o usuário não conhecia os códigos e indicou o módulo do log como referência. Adotada a regra
    já validada no CFGR700 (`REGRAS_CFGR700.md`, seção 5): `1` = Manual, `2` = Automático, outro valor ou vazio =
    Não identificado, códigos configuráveis.
  - **Usuário em "Origem":** fora do escopo.
  - **Chave do documento:** tipo de saldo e moeda **fora da chave** e tratados em separado. Escolhida a separação
    por segmento (tipo de saldo + moeda): o balanceamento de documento, lote e dia é medido dentro de cada segmento,
    sem somar moedas ou tipos de saldo diferentes; a chave da linha (E1) inclui o segmento para não apontar como
    duplicada a mesma linha em duas moedas; a Base é ordenada por segmento para manter os blocos contíguos (CI-2).
    Alternativas rejeitadas: analisar só o tipo de saldo e a moeda esperados (as demais linhas ficariam sem
    balanceamento) e somar tudo com alerta (somaria moedas diferentes).
- 21/10/2026 — Fase 9 (leitura), respostas do usuário:
  - **Liberação:** o módulo fica disponível no site como **prévia**, com aviso de que só lê e reconcilia; painel,
    tabelas e exportação ficam bloqueados até a Fase 10.
  - **Linhas incompletas:** regra **conservadora**: linha com conteúdo e sem nenhum campo da chave é detalhe e falha
    CI-4; linha, tipo de saldo ou moeda vazios falham CI-4; valor vazio é 0 só na continuação de histórico.
  - **Linhas depois de 999:** ordenadas pela **ordem do texto** (`A00` < `A01` < … < `B00`); E2 continua valendo
    só para `001`–`999`.
  - **Padrões de leitura aprovados com o plano:** títulos comparados depois de tirar os espaços das pontas e reduzir
    os repetidos (maiúsculas e acentos contam); título repetido de coluna mapeada é erro; com várias abas vale a que tem o
    cabeçalho (duas é erro); códigos sem espaços nas pontas, célula numérica completada com zeros na largura
    configurada (lote 6, documento 6, linha 3, sub-lote 3, moeda 2, tipo de saldo 1), outros códigos não; serial do
    Excel com fração é CI-4; texto de valor só no formato pt-BR; vários arquivos unidos pelo título das colunas, com
    alerta; o aviso de arquivo trocado mantém a lista de arquivos; arquivos reais da CT2 em `local/ct2/`; arquivos
    de medição na pasta temporária do sistema.
- 29/10/2026 — Fase 10 (motor), respostas do usuário:
  - **B4, dois vizinhos:** testa primeiro o documento **seguinte** do mesmo lote e segmento (na ordem da Base) e
    depois o anterior; aponta o primeiro que compensa. A compensação é **exata**: a soma das duas diferenças é 0,00,
    sem a tolerância do B1.
  - **I4 com "Valor Moeda1" vazio:** a linha fica **fora do teste** (sem valor para comparar), como a ilegível.
  - **P3 e segmentos:** o documento é contado pela **chave do documento sem o segmento**: a mesma contabilização em
    duas moedas não aparece como Seq CTK repetido.
  - **Tela ao fim da Fase 10:** o módulo continua como prévia e a reconciliação ganha um **quadro de testes** com as
    ocorrências de cada teste e os invariantes novos.
  - **Extração com mais de um mês:** não é problema; o período padrão cobre **todos os meses lidos** (do 1º dia do
    mês da menor data ao último dia do mês da maior), e a tela **sinaliza o período analisado** com a quantidade de
    meses (reconciliação e quadro de testes). Antes, o padrão era só o mês da menor data, o que fazia as linhas dos
    meses seguintes caírem em E5. E5 e CI-10 passam a apontar só datas fora de um período informado (tela de
    parâmetros, Fase 12).
