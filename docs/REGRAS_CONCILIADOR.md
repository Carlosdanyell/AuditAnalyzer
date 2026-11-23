# Conciliador — regras do módulo

Módulo `reconciliation` ("Conciliador", código curto `CONC`) da plataforma AuditAnalyzer. Confronta relatórios
de origem (folha de pagamento, provisões e, depois, bancos, clientes, fornecedores e adiantamentos) com o razão
contábil e gera um papel de trabalho em Excel amarrado por fórmulas. Vale tudo do `CLAUDE.md` e de `docs/MODULOS.md`
(nada sai da máquina, memória controlada, determinismo, centavos inteiros, repositório público sem dados reais).

> **Situação (23/11/2026):** todas as regras abaixo foram **validadas em protótipo contra um mês real fechado**:
> - Folha (Padrão A): os esperados e as diferenças de todas as contas iguais, ao centavo, aos do papel de trabalho
>   manual do usuário.
> - Provisões (Padrão B): relatórios de férias e 13º fecham com o razão por conta, por filial e por linha da ponte.
> - Formatos: o mesmo relatório lido em TXT, PDF e (razão) XML produz os mesmos registros.
>
> Onde está escrito **PENDENTE** ou **não observado**, pare e pergunte; não complete por suposição.

**Revisão de 23/11/2026** (para quem já começou a Fase 15): razão em TXT, XML e PDF (seção 5), com XLSX à espera de
amostra; leitura de PDF aprovada para todos os relatórios (3.3); chave de filial do razão = `FILIAL CTB` (7.2);
razão pode cobrir mais de um mês (5.5); qualquer diferença é sinalizada, sem materialidade (7.3, D-7); Padrão B
completo (seção 8) dentro do mesmo perfil; pendências e decisões atualizadas (12, 13). Também em 23/11: razão real
(tipo 1) e pré-lançamento (tipo 9) da mesma conta combinados numa visão única (5.7); a antiga trava "mesmo tipo de
saldo em todos os razões" deixou de existir.

Convenções deste documento:
- **Regra** = comportamento obrigatório. **Decisão** = escolha do usuário, com data (seção 13).
- Exemplos usam dados **inventados** (empresa "EMPRESA X", filiais 01/02, códigos e valores fictícios). Os códigos
  reais de verbas, contas e lotes ficam no perfil local (`local/conciliador/perfil-folha.json`, fora do git).
- "Natureza" da conta: lado em que o saldo é normal (`C` para passivo, `D` para ativo). Todo valor do motor é
  **assinado na natureza da conta**: positivo aumenta o saldo normal, negativo reduz.
- "Competência" = mês da folha (`Periodo: AAAAMM` do GPER040 ou `Data Base` das provisões).

---

## 1. Objetivo e escopo

O usuário concilia mensalmente as contas patrimoniais ligadas à folha. Hoje o trabalho é manual: soma verbas nos
relatórios, compara com o saldo do razão e explica cada diferença pela movimentação da conta. O módulo automatiza o
que é determinístico e deixa para o usuário só o julgamento:

| Faz (determinístico) | Não faz (julgamento do usuário) |
|---|---|
| Lê os relatórios e prova que a leitura fechou (invariantes) | Decidir se uma diferença é material |
| Calcula o saldo esperado de cada conta a partir dos relatórios | Escrever a justificativa final da diferença |
| Confere cada lançamento de integração com a folha ou a provisão, por filial | Propor lançamento de ajuste |
| Identifica a baixa do saldo anterior por combinação exata de valores | Interpretar norma (CLT, tributos) |
| Monta a ponte do esperado ao saldo contábil, item a item | Alterar o histórico de lançamentos de origem |
| Sinaliza **qualquer** diferença, a partir de R$ 0,01 | Aplicar limite de materialidade do papel de trabalho |

Perfil desta entrega: **Folha**, com dois padrões de conta: Padrão A (verbas da folha, seção 7) e Padrão B
(provisões de férias e 13º, seção 8). Outros perfis na seção 14.

## 2. Arquitetura: um módulo, motor comum, perfis, adaptadores de formato

**Decisão D-1 (16/11/2026):** um único módulo "Conciliador" com **perfis de conciliação**. Cada perfil declara as
fontes que aceita e as regras que aplica; leitura, casamento, ponte, planilha e tela são do motor comum.

**Decisão D-3 (19/11/2026):** cada relatório pode chegar em qualquer formato que o Protheus exporta (TXT, PDF com
texto selecionável, XML e XLSX quando existirem). Cada formato é um **adaptador** que entrega ao leitor do relatório
o mesmo material; as invariantes de leitura valem para todos, sem exceção.

```
src/worker/modules/reconciliation/
  index.ts                 # WorkerModule: configure → ingest; despacha para o perfil
  formats/                 # adaptadores de formato → "linhas de largura fixa" ou "linhas de planilha"
    text.ts                # TXT do spool: fluxo Blob → TextDecoder → linhas normalizadas (4.1)
    pdf.ts                 # PDF: reconstrução da grade monoespaçada (3.3)
    spreadsheetml.ts       # XML SpreadsheetML 2003, em fluxo (5.3)
    xlsx.ts                # XLSX, sobre src/worker/ingest/readSheet.ts (5.4; PENDENTE de amostra)
  reports/                 # leitores de relatório: recebem linhas, devolvem registros + relatório de leitura
    gper040.ts             # folha (seção 4)
    provision.ts           # GPER070 e GPER090 (seção 8.1), um leitor com duas configurações
    ctbr400.ts             # razão (seção 5)
  match/                   # primitivas puras, sem regra de negócio
    exactKey.ts  subsetSum.ts
  bridge.ts                # ponte esperado → saldo contábil (7.5 e 8.4)
  profiles/payroll/        # perfil Folha: config.ts expected.ts integration.ts settlement.ts provision.ts
                           #               findings.ts narrative.ts
  workpaper.ts  workpaperLabels.ts  tables.ts  panel.ts
src/modules/reconciliation/module.ts   # descritor da tela
src/config/defaults/reconciliation.json
src/shared/modules/reconciliation.ts   # tipos de painel, tabelas e filtros
```

Regras de fronteira:
1. `formats/` não conhece relatório; `reports/` não conhece formato; `match/` e `bridge.ts` não conhecem folha,
   verba nem conta (recebem `{ key, amount, date, index }`).
2. Perfil novo = pasta nova em `profiles/` + schema próprio. Nenhum `if (profile === …)` fora de `profiles/`.
3. Uma sessão = um perfil e uma competência.

## 3. Catálogo das fontes e formatos

| ID | Relatório (Protheus) | TXT (spool) | PDF | XML | XLSX | Papel |
|---|---|---|---|---|---|---|
| S-1 | GPER040 — Folha | **validado** | **validado** | não existe | não existe | verbas por funcionário e totais por filial, empresa e grupo |
| S-2 | CTBR400 — Razão analítico | **validado** | **validado** | **validado** | PENDENTE de amostra | lançamentos e saldos por conta |
| S-3 | GPER070 — Provisão de férias (analítica ou sintética) | **validado** | **validado** | não existe | não existe | ponte da provisão de férias |
| S-4 | GPER090 — Provisão de 13º (analítica ou sintética) | **validado** | **validado** | não existe | não existe | ponte da provisão de 13º |
| S-5 | CTBR040 — Balancete | — | — | — | — | opcional; sem amostra |

O relatório sintético das provisões tem os mesmos blocos de totalização do analítico, sem os colaboradores; o leitor
é o mesmo. O analítico é o preferido (permite conferir filial = Σ colaboradores).

### 3.1 Identificação do arquivo (`detect`)

Por conteúdo, nunca pelo nome nem pela extensão (o Protheus grava o spool como `.##r`/`.__r`). Ler só o início:
- TXT: primeiros 64 KB normalizados (4.1). PDF: texto da 1ª página. XML: até a 1ª `Worksheet`.
- Relatório pelo identificador `SIGA /<ROTINA>/v.NN` (cabeçalho de página): `GPER040`, `GPER070`, `GPER090`,
  `CTBR400`. No XML do razão, pela linha de títulos com `DATA`, `LOTE/SUB/DOC/LINHA`, `HISTORICO`, `DEBITO`,
  `CREDITO`, `SALDO ATUAL` e pela aba `Parametros`.
- Arquivo sem papel reconhecido: aviso, não bloqueia. A análise exige ao menos um razão e um relatório de origem.
- O mesmo relatório em dois formatos na mesma sessão: aceito só se a leitura der registros idênticos (V-3); senão,
  bloqueia e mostra a primeira divergência.

### 3.2 Plataforma

`accepts.extensions`: aceitar qualquer extensão e decidir pelo conteúdo (o spool não tem extensão fixa); o seletor de
arquivos mostra a dica "TXT do spool, PDF, XML ou XLSX exportados do Protheus". SHA-256 e tamanho de todo arquivo na
Rastreabilidade; para PDF, também a versão da biblioteca de leitura.

### 3.3 Adaptador de PDF

**Decisão D-6 (19/11/2026):** aprovada a dependência `pdfjs-dist`, **empacotada no app** (sem CDN e sem rede).
Configuração obrigatória: `isEvalSupported: false`, `disableFontFace: true`, `useSystemFonts: false`, sem `cMapUrl`
remoto, worker do pdf.js servido pelo próprio app. Conferir a CSP de `index.html` (`worker-src 'self'`) e o teste e2e
"nenhuma requisição externa".

Fato observado nos PDFs reais (todos gerados pelo Protheus via navegador): o corpo do relatório usa **uma fonte
monoespaçada**; os cabeçalhos de página usam fonte proporcional; as linhas de separação (`----`, `####`, `****`) são
desenho, não texto.

Algoritmo (página a página, liberando cada página depois de lida):
1. `getTextContent()`; separar os itens da fonte monoespaçada dos demais.
2. Passo do caractere: moda de `item.width / item.str.length` dos itens monoespaçados com 2+ caracteres
   (arredondar a 0,001). Um item é monoespaçado quando a sua razão fica a até 0,5% do passo.
3. Origem X: o menor x entre os itens monoespaçados **do documento inteiro** (nos reais, a mesma em todas as páginas).
4. Cada caractere `i` do item fica na coluna `(x − origemX) / passo + i`. Coluna a mais de 0,15 de um inteiro =
   caractere fora da grade → **PDF rejeitado** (V-1), nunca arredondado.
5. Linha = itens com o mesmo y (arredondar a 0,1 pt), de cima para baixo; colunas vazias = espaço.
6. O texto proporcional vai, em ordem de leitura, para o "cabeçalho da página": dele saem o identificador do
   relatório e, no razão, os parâmetros (`Pergunta NN : … ? valor`) e o intervalo de datas.

Resultado validado: as linhas reconstruídas são **idênticas** às do TXT do mesmo relatório, exceto (a) as linhas de
separação e de cabeçalho, que o TXT tem e o PDF não, e (b) os acentos, que no PDF vêm corretos e no TXT vêm como
`U+FFFD`. Por isso os leitores de relatório **não podem depender** de linhas de separação nem de cabeçalho de
página para nada além de identificação, e nenhuma regra depende de texto acentuado.

Fora do escopo: PDF digitalizado (imagem), sem OCR. PDF sem fonte monoespaçada no corpo → rejeitado com mensagem.

### 3.4 Equivalência entre formatos (invariantes V)

| Código | Regra |
|---|---|
| V-1 | PDF: nenhum caractere monoespaçado fora da grade. |
| V-2 | Teste local obrigatório: o mesmo relatório em formatos diferentes produz os mesmos registros normalizados (mesmas linhas de verba, de provisão ou de razão, mesmos valores, mesma ordem). |
| V-3 | Na mesma sessão, o mesmo relatório em dois formatos só é aceito se V-2 valer para os dois arquivos. |

---

## 4. Leitor S-1 — GPER040 (folha)

Entrada: linhas de largura fixa (TXT normalizado ou PDF reconstruído). Validado com um mês completo (várias
filiais, dois tipos de contrato).

### 4.1 Normalização do TXT (vale para todo spool: GPER040, GPER070, GPER090, CTBR400)

1. Decodificar como **UTF-8**; se a decodificação estrita falhar, usar **windows-1252**. Registrar qual foi usado.
   Nos arquivos reais os acentos já vêm trocados por `U+FFFD`: **nenhuma regra pode depender de texto acentuado**.
2. Remover sequências de controle de impressora: `ESC` (0x1B) seguido de **dois** bytes quaisquer.
3. Tratar `FF` (0x0C) como fim de linha e remover os demais caracteres de controle 0x00–0x1F, exceto o fim de linha
   (sobram `0x02`/`0x03` depois do passo 2). Aceitar CRLF e LF.
4. Não aparar espaços à esquerda: as posições são absolutas (base 0) **depois** dos passos 2 e 3.

Leitura em fluxo (`Blob.stream()` + `TextDecoder` com `stream: true`), linha a linha; nunca o arquivo inteiro numa
string. Contar bytes e linhas para a Reconciliação de leitura.

### 4.2 Tipos de linha

Classificar cada linha pela primeira regra que casar (ordem importa):

| Tipo | Regra | Uso |
|---|---|---|
| `pageRule` | começa com `****` | ignora (ausente no PDF) |
| `pageHeader` | começa com `*` | identificação (ausente no PDF) |
| `companyHeader` | começa com `Empresa:` e contém `Contrato do Tipo :` | contexto: `Fil.: NN` (ausente no nível empresa/grupo) e tipo de contrato |
| `processHeader` | começa com `Processo:` | `Periodo: AAAAMM` (competência), `Numero de Pagamento: NN`, `Dt Pagto:` |
| `employeeHeader` | começa com `C.CUSTO:` | centro de custo, `MAT.:`, `NOME:`, `FUNCAO:` |
| `employeeData` | começa com `DT.ADM.:` ou `Sit. Folha:` | informativo |
| `totalLabel` | começa com `Filial: `, `Empresa: ` (sem `Contrato do Tipo`) ou `Grupo de Empresas: ` | abre um bloco de totalização (4.4) |
| `columnTitle` | contém `P R O V E N T O S` | ignora |
| `columnHeader` | começa com `COD DESCRICAO` | abre o corpo de um bloco |
| `verbaLine` | `length ≥ 95`, caractere 46 = `|` e caractere 94 = `|` | linha de verbas (4.3) |
| `footer` | começa com `TOTAIS ->` | fecha o bloco (4.5) |
| `counts` | começa com `Sit.Normal:`, `Ferias:` ou `Total:` | contagens do bloco de totalização |
| `rule` | começa com `----` | ignora (ausente no PDF) |
| `blank` | vazia ou só espaços | ignora |
| `unknown` | qualquer outra | conta e mostra na reconciliação; proibida entre `columnHeader` e `footer` (L-1) |

### 4.3 Linha de verbas (posições absolutas, base 0, fim exclusivo)

Cada linha traz até três verbas, uma por coluna. Exemplo inventado (régua abaixo):

```
A10 SALARIO            30,00       2.000,00 00| B20 DESC X              0,00         150,00 00| C30 BASE Y                 160,00
000000000011111111112222222222333333333344444444445555555555666666666677777777778888888888999999999900000000001111111111222222222   ← dezenas (0 = 0–9, 1 = 10–19 … depois de 99 volta a 0)
012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678   ← unidades
```

| Coluna | Trecho | Código | Descrição | Referência (fim) | Valor (fim) | Parcela |
|---|---|---|---|---|---|---|
| `P` Proventos | `[0,46)` | `[0,3)` | `[4,18)` | 28 | 43 | `[44,46)` |
| `D` Descontos | `[47,94)` | `[48,51)` | `[52,66)` | 76 | 91 | `[92,94)` |
| `B` Bases | `[95,fim)` | `[96,99)` | `[100,118)` | — | 129 | — |

- Coluna em branco = só espaços. Coluna preenchida: o valor é o número que **termina** na posição indicada, no
  formato `-?[\d.]*\d,\d\d`; converter para centavos inteiros sem `parseFloat`.
- Código: 3 caracteres `[0-9A-Z]` (há códigos alfanuméricos, ex.: `17C`, `84A`). Guardar como texto.
- Um mesmo código nunca aparece em duas colunas (L-6).
- Num bloco de totalização o mesmo código pode repetir em várias linhas: o valor do bloco é a **soma** das linhas.

### 4.4 Blocos

Um bloco começa em `columnHeader` e termina em `footer`:
- **Funcionário:** precedido (desde o último `footer`) por `employeeHeader`. Atributos: matrícula, centro de custo,
  filial e tipo de contrato do último `companyHeader`.
- **Totalização:** precedido por `totalLabel`. Atributos: nível (`branch` = "Filial: NN - …", `company` =
  "Empresa: …", `groupOfCompanies` = "Grupo de Empresas: …"), filial (só em `branch`) e tipo de contrato do último
  `companyHeader`.

Atenção: o rótulo `Empresa: X` sem `Contrato do Tipo` (tipo `totalLabel`) **não** altera o contexto.

Estrutura observada: funcionários agrupados por tipo de contrato e filial; depois de cada grupo, as totalizações:
(cada filial + empresa) × (Indeterminado, Determinado, Todos); o último bloco é **Grupo de Empresas / Todos**.
O leitor não depende da quantidade de filiais nem da ordem.

### 4.5 Rodapé `TOTAIS ->`

Números, na ordem: soma das referências de proventos, **total de proventos**, soma das referências de descontos,
**total de descontos**, e o valor após `SALARIO LIQ.`. Extrair por expressão regular, não por posição.

### 4.6 Invariantes de leitura (bloqueiam a análise)

| Código | Regra |
|---|---|
| L-1 | Nenhuma linha `unknown` dentro de um bloco; todo bloco aberto é fechado por `footer`. |
| L-2 | Em todo bloco: Σ coluna P = total de proventos do rodapé; Σ coluna D = total de descontos. |
| L-3 | Em todo bloco: proventos − descontos = líquido do rodapé = verba de líquido (`netPayCode`) na coluna B; ausente só se a diferença for 0. |
| L-4 | Bloco `branch` com contrato `Indeterminado`/`Determinado`: por verba e coluna, Σ dos funcionários da filial e contrato = bloco. |
| L-5 | `Todos` = `Indeterminado` + `Determinado`; `company` = Σ filiais; `groupOfCompanies` = Σ empresas. |
| L-6 | Nenhum código de verba em mais de uma coluna. |
| L-7 | Uma única competência (`Periodo: AAAAMM`) e um único número de pagamento no arquivo. |

`Total:` do bloco `groupOfCompanies`/`Todos` = número de blocos de funcionário lidos.

Resultado (`PayrollReport`): por escopo (nível, filial, contrato), mapa `código → { column, amountCents }`; blocos de
funcionário guardados só para detalhe.

---

## 5. Leitor S-2 — CTBR400 (razão)

Validado com o razão de uma conta exportado nos três formatos (TXT, XML e PDF) para um intervalo de dois meses: as
três leituras deram as mesmas linhas, na mesma ordem, com os mesmos valores, filiais, contrapartidas e saldos.

### 5.1 Registros normalizados (iguais para todos os formatos)

- **Parâmetros:** `Pergunta NN → (rótulo, valor)`. Obrigatórios na Rastreabilidade: 01/02 conta inicial/final
  (código sem pontos), 03/04 datas, 05 moeda, 06 tipo de saldo (`1` real, `9` pré-lançamento), 08 tipo de relatório.
  O tipo de saldo de **todas** as linhas do arquivo é o do parâmetro 06: o relatório não marca o tipo por linha.
- Saldos com valor zero vêm sem D/C (`0,00`); tratar como zero.
- **Conta:** código, descrição, saldo anterior (na data inicial do relatório), linhas, totais do fecho.
- **Linha:** data, chave `LOTE/SUB/DOC/LINHA` (18 dígitos = lote 6 + sublote 3 + documento 6 + linha 3), histórico,
  contrapartida, centro de custo, filial CTB, grupo de produto, débito e crédito em centavos, saldo corrido com D/C.
- **Identidade da linha = (data, chave).** A chave sozinha repete entre meses (observado no real).
- Filial de origem só existe no XML e **não** é usada em regra (ela difere da filial CTB nos lançamentos do Financeiro
  e nos manuais, e não existe no TXT nem no PDF).

### 5.2 TXT e PDF (linhas de largura fixa)

Linha de títulos (repetida a cada página): `LOTE/SUB/DOC/LINHA  H I S T O R I C O … C/PARTIDA … C CUSTO … FILIAL CTB
… GRP PRODUT … DEBITO … CREDITO … SALDO ATUAL`. Localizar as colunas pelo início de cada título nessa linha (no real:
0, 20, 60, 85, 111, 137, 165, 186, 204) e conferir com a tabela abaixo; título fora da posição → parar e perguntar.

| Tipo | Regra |
|---|---|
| parâmetro | `Pergunta NN : <rótulo> ? <valor>` (TXT: no corpo; PDF: no texto proporcional, 3.3) |
| cabeçalho/separação | começa com `*`, linhas de página (empresa, CNPJ, `SIGA /CTBR400/`, `Hora...`, `Pagina:`), `DATA`, títulos, `----` |
| grupo sintético | `^\s*\d+(\.\d+)+\s+- ` | ignora |
| abertura de conta | contém `CONTA - <código>` e `SALDO ANTERIOR:` → código, descrição, saldo anterior com D/C |
| transporte | `A TRANSPORTAR :` (fim de página) e `CONTA - … DE TRANSPORTE :` (início da seguinte): o valor = saldo corrido naquele ponto (R-5); não abre conta nova |
| data | linha só com `dd/mm/aaaa`: data das linhas seguintes |
| lançamento | `^\d{18} ` |
| fecho | começa (após espaços) com `T o t a i s  d a  C o n t a  ==>` : débitos, créditos, saldo final |
| total geral | `T O T A L  G E R A L ==>` : débitos e créditos |

Campos do lançamento (base 0, fim exclusivo): chave `[0,18)`, histórico `[19,59)` (40 caracteres), contrapartida
`[60,85)`, centro de custo `[85,111)`, filial CTB `[111,137)`, grupo de produto `[137,160)`; os três números a partir
da coluna 160, extraídos por expressão regular **da direita para a esquerda**: saldo (`[\d.]*\d,\d\d( [DC])?`),
crédito, débito. Formato com ponto de milhar e vírgula decimal. Exemplo inventado:

```
000777001000012001 A10 SALARIO 10/2026                                                                          01                                                        0,00              2.000,00            2.000,00 C
```

Continuação de histórico (linha sem chave com texto na faixa do histórico): **não observada** nas amostras. Se
aparecer, é linha `unknown` dentro da conta → falha R-6; pare e peça a amostra.

### 5.3 XML (SpreadsheetML 2003)

- Arquivo XML único (`<?mso-application progid="Excel.Sheet"?>`), não é ZIP. Abas `Parametros` (coluna 1 = pergunta,
  coluna 2 = resposta) e a aba do razão (nome observado: `15-01 - Emissao do Razao Conta`; localizar pela linha de
  títulos, não pelo nome).
- Leitura em fluxo (o tokenizador de XML da plataforma pode ser reaproveitado; não usar `DOMParser`). Respeitar
  `ss:Index` (célula pula colunas) e `ss:MergeAcross`; textos podem vir em CDATA.
- Tipos: `DateTime` `AAAA-MM-DDT00:00:00`; `Number` com ponto decimal e casas variáveis (`90869.51`, `500018.9`,
  `8641568`) → converter o **texto** para centavos, nunca via `parseFloat`; `SALDO ATUAL` e `SALDO ANTERIOR` em texto
  pt-BR com D/C.
- Tipos de linha: títulos (coluna 1 = `DATA`), `CONTA`/`DESCRICAO`, grupo sintético, abertura (`CONTA - <código> -
  <descrição>` com `SALDO ANTERIOR: …` na coluna 2), lançamento (coluna 1 data **e** coluna 2 preenchida),
  continuação de histórico (coluna 1 data, coluna 2 vazia, coluna 3 texto → concatenar ao histórico anterior **sem**
  espaço; não observada), fecho (`T o t a i s  d a  C o n t a`, totais na linha seguinte, colunas 9–11), total
  geral (idem, colunas 9–10).
- Colunas: 1 data, 2 chave, 3 histórico, 4 contrapartida, 5 filial de origem, 6 centro de custo, 7 filial CTB,
  8 grupo de produto, 9 débito, 10 crédito, 11 saldo.

### 5.4 XLSX — PENDENTE

Sem amostra da exportação em XLSX. Não implementar o leitor do XLSX do Protheus antes de receber o arquivo (P-1). A
cópia do razão colada no papel de trabalho do usuário (aba "3", com coluna extra "Visão" e linhas de faixa
"Documento arquivado no diretório: …") é aceita **somente** como fonte de teste local (seção 6.3 da Fase 15), porque é
o único razão real disponível para parte das contas.

### 5.5 Competência e intervalo do razão

O razão pode cobrir mais de um mês (amostra real: dois meses). Regras:
- O intervalo do relatório (parâmetros 03/04) tem de **conter** a competência inteira (R-4).
- Saldo inicial da competência = saldo anterior do relatório + Σ das linhas com data anterior ao 1º dia da
  competência. É esse saldo que entra como "saldo anterior" no motor; a tela mostra os dois.
- Linhas depois do último dia da competência ficam fora da análise e são listadas (informativo).

### 5.6 Invariantes do razão (bloqueiam)

| Código | Regra |
|---|---|
| R-1 | Por conta: saldo anterior + Σ (crédito − débito) = saldo final do fecho; Σ débitos e Σ créditos = totais do fecho. |
| R-2 | Saldo corrido de cada linha = saldo anterior + Σ das linhas até ela. |
| R-3 | Toda linha de lançamento tem chave de 18 dígitos, data válida e exatamente um dos lados > 0 (ou ambos 0). |
| R-4 | O intervalo do relatório contém a competência. |
| R-5 | TXT/PDF: cada `A TRANSPORTAR` e `DE TRANSPORTE` = saldo corrido naquele ponto. |
| R-6 | Nenhuma linha `unknown` entre a abertura e o fecho de uma conta. |
| R-7 | Todos os razões da sessão têm a mesma moeda (05). A mesma conta no mesmo tipo de saldo em dois arquivos só é aceita se as leituras forem iguais. |
| R-8 | O mesmo lançamento (data, chave) não aparece nos dois tipos de saldo (5.7). |
| R-9 | Tipo de saldo do parâmetro 06 só `1` ou `9`; no TXT/PDF, o marcador `(Pre-Lancamento)` do título aparece se e somente se o parâmetro 06 for `9`. |

O tipo de saldo aparece na Reconciliação e no Resumo da planilha (5.7).

### 5.7 Tipos de saldo: real (1) e pré-lançamento (9)

Regra interna do usuário: todo lançamento do mês fica em pré-lançamento (tipo 9) até a conta ser conciliada; os meses
anteriores já estão efetivados (tipo 1). No fechamento, portanto, o saldo da conta = real + pré-lançamento.
Validado com uma amostra real em tipo 9 (saldo anterior zero, só lançamentos do mês aberto).

- O usuário extrai o razão da conta duas vezes, uma em cada tipo, com o mesmo intervalo; cada arquivo cumpre R-1 a
  R-6 sozinho.
- **Visão combinada** por conta: linhas = união dos dois arquivos, em ordem (data, chave), cada uma com o seu tipo;
  saldo anterior = soma dos saldos anteriores; saldo inicial da competência e saldo final = soma dos dois tipos. O
  motor (F1, F3, ponte, B1–B3) usa sempre a visão combinada.
- Só um dos tipos carregado: a análise roda com ele e a tela diz qual falta.
- Lançamento repetido nos dois tipos (R-8) bloqueia: indica extração feita antes e depois de uma efetivação.

| Código | Severidade | Quando |
|---|---|---|
| T1 | Alerta (não bloqueia) | Saldo anterior do razão tipo 9 ≠ 0. Normalmente é zero; diferente de zero indica pré-lançamento de período anterior ainda não efetivado, que pode ser antigo. Mostrar o valor e a data inicial do relatório. |
| T2 | Info | Há pré-lançamentos na competência: quantidade, débitos, créditos e quanto do saldo final está em tipo 9. |
| T3 | Alerta (não bloqueia) | Conta só com razão tipo 9: o saldo inicial não inclui o saldo efetivado dos meses anteriores. |

Tela e planilha: a coluna "Tipo de saldo" ("Real (1)" ou "Pré-lançamento (9)") em toda linha do razão; no Resumo, por
conta, saldo real, saldo em pré-lançamento e saldo combinado; a ponte separa os movimentos da competência por classe
de lote **e** por tipo de saldo.

**Classe do lote** (`batchClasses`, primeira regra que casar): `integration` (integração da folha), `financial`
(Financeiro), `manual` (padrão `ddmmaa` do lote manual), `other`. Só `integration` participa de casamento.

**Verba da linha de integração:** `verbaFromHistory` (no real `^(?<code>[0-9A-Z]{3}) `; a integração grava
"<verba> <descrição> MM/AAAA"). Linha de integração sem verba reconhecível = achado F1d.

---

## 6. Perfil Folha — configuração

Schema (zod) em `src/config/defaults/reconciliation.json`, `schemaVersion: 1`. O padrão versionado tem
`accounts: []`; o perfil real é importado na tela Configuração.

```ts
interface PayrollProfileConfig {
  payrollReport: {
    scope: { level: 'groupOfCompanies' | 'company'; contractType: 'Todos' | 'Indeterminado' | 'Determinado' };
    netPayCode: string;                 // verba do líquido (L-3 e modo netPay)
  };
  provisionReports: {
    scope: 'groupOfCompanies';
    reversalMarker: string;             // texto do histórico que marca estorno de provisão (no real " NEG ")
    vacation:   { columns: string[] };  // títulos das 8 colunas do GPER070, na ordem
    thirteenth: { columns: string[] };  // idem GPER090
  };
  ledger: {
    batchClasses: { id: 'integration' | 'financial' | 'manual' | 'other'; label: string;
                    match: { prefix?: string; pattern?: string } }[];
    verbaFromHistory: string;           // regex com grupo nomeado "code"
    columns?: Record<LedgerField, string>;   // títulos (XML/XLSX); padrão = títulos do Protheus
  };
  settlementSearch: { maxCandidates: number };   // padrão 40 (7.4)
  workpaperStatuses?: string[];         // situações do papel de trabalho do usuário (texto livre; nunca preenchidas pelo módulo)
  accounts: PayrollAccount[];
}

type PayrollAccount = {
  account: string; name: string; naturalSide: 'D' | 'C'; tickMark: string;   // "#01"…
} & (
  | { mode: 'verbas'; verbas: { code: string; sign: 1 | -1; column?: 'P' | 'D' | 'B' }[]; settlementVerbas?: string[] }
  | { mode: 'netPay'; netPayCode: string }
  | { mode: 'provision'; report: 'vacation' | 'thirteenth'; column: string;
      verbas: { accrual: string[]; vacationRelease?: string[]; terminationRelease: string[] } }
);
```

- `verbas`: a conta recebe um conjunto de verbas; `sign: -1` reduz a conta. `column` é conferida.
- `netPay`: contrapartida geral (salários a pagar): uma linha de integração para **cada** verba de provento (natureza
  C) e de desconto (natureza D); esperado = verba de líquido.
- `provision`: Padrão B (seção 8). `column` = título da coluna do relatório (ex.: `TOTAL FERIAS`, `I.N.S.S.`,
  `F.G.T.S`, `TOTAL 13o`). `vacationRelease` só em contas de férias.
- Arquivo de perfil (importar/exportar): `{ "schemaVersion": 1, "profile": "payroll", ...PayrollProfileConfig }`;
  substitui `profiles.payroll` inteiro.
- Validações: conta repetida; verba repetida na mesma conta; verba em mais de uma conta `verbas` (aviso);
  `settlementVerbas` sem interseção com `verbas`; em `provision`, `column` existente nas colunas do relatório e as três
  listas de verbas sem interseção.
- Conta cujo relatório de origem não foi carregado na sessão: "não analisada — falta <relatório>" (não é erro).

---

## 7. Motor — Padrão A (verbas da folha)

Escopo de valores: bloco do nível e contrato de `payrollReport.scope` (no real: Grupo de Empresas / Todos). Escopo
por filial para o casamento: blocos `branch` com o mesmo contrato.

### 7.1 Esperado da conta (F2)

- `verbas`: `esperado = Σ sign × valor(verba)` no escopo.
- `netPay`: `esperado = valor(netPayCode)` no escopo.

### 7.2 Integração × folha (F1), verba × filial — chave exata

Chave = `(filial, código da verba)`. Folha: valor da verba no bloco `branch` da filial. Razão: Σ, na natureza da
conta, das linhas de integração **da competência** com aquela `FILIAL CTB` e verba (pode reunir várias linhas, ex.:
por centro de custo). **Decisão D-8 (23/11/2026):** a filial do razão é sempre a `FILIAL CTB`.

| Código | Severidade | Exceção quando |
|---|---|---|
| F1a | Erro | Chave nos dois lados com valores diferentes (`verbas`: razão ≠ sign × folha; `netPay`: razão ≠ +P / −D). |
| F1b | Alerta | Linha de integração na conta com verba fora do critério e fora de `settlementVerbas`. |
| F1c | Alerta | Verba do critério com valor ≠ 0 numa filial, sem integração na conta (`netPay`: qualquer verba P ou D ≠ 0). Típico de verba lançada manualmente. |
| F1d | Alerta | Linha de integração sem verba reconhecível no histórico. |
| F1e | Info | `netPay`: verba da coluna B com linha de integração na conta. |

Referência real (golden local): todas as linhas de integração iguais à folha; na conta `netPay`, os F1c apontaram
exatamente as verbas que o usuário lançou manualmente no mês. O resultado é o mesmo com o razão em TXT, XML e PDF.

### 7.3 Saldo contábil × esperado (F2)

`saldoContabil` = saldo final do razão no último dia da competência, na natureza. **Diferença = esperado −
saldoContabil** (convenção da capa do usuário: suporte − contábil).

**Decisão D-7 (19/11/2026):** qualquer diferença diferente de zero, a partir de R$ 0,01, é sinalizada. O módulo não
aplica limite de materialidade (o limite do papel de trabalho do usuário fica fora dele).

### 7.4 Baixa do saldo anterior (F3) — combinação exata de valores

1. Alvo = saldo inicial da competência na natureza (5.5); se ≤ 0, `SEM_SALDO_ANTERIOR`.
2. Candidatos = linhas da competência que **reduzem** o saldo, exceto integração de verbas do critério; incluem as
   de integração de `settlementVerbas`. Peso = |valor|.
3. Subconjuntos com soma **exata** igual ao alvo (centavos), por meet-in-the-middle, candidatos em ordem estável
   (data, chave). Mais de `maxCandidates` candidatos: `NAO_PESQUISADA` (nunca truncar a lista).
4. Desempate: menor data do último lançamento; depois menos lançamentos; depois sequência de índices
   lexicograficamente menor. Empate nos dois primeiros critérios entre a 1ª e a 2ª: `IDENTIFICADA_AMBIGUA`.
5. Situações: `IDENTIFICADA`, `IDENTIFICADA_AMBIGUA`, `NAO_IDENTIFICADA`, `NAO_PESQUISADA`, `SEM_SALDO_ANTERIOR`.

Sem tolerância. `NAO_IDENTIFICADA` é informação, não erro. Medir com 40 candidatos; acima de ~300 ms no worker,
parar e perguntar.

### 7.5 Ponte do esperado ao saldo contábil (F4)

Identidade (invariante CC-3):

```
saldoContabil = esperado
              + (integração das verbas do critério − esperado)                    // ≠ 0 só com F1a/F1c
              + integração de verbas fora do critério, exceto a usada na baixa     // F1b
              + (saldoInicialCompetência − Σ |lançamentos da baixa identificada|)  // 0 quando F3 = IDENTIFICADA
              + Σ demais movimentos da competência fora da baixa, por classe de lote
```

- Em `netPay`, "integração das verbas do critério" = Σ das linhas de integração das verbas P e D.
- Com F3 `NAO_IDENTIFICADA`, a 4ª parcela vale o saldo inicial inteiro e a baixa aparece na 5ª.
- Cada parcela da 5ª linha é detalhada por lançamento (data, chave, histórico, valor).
- A ponte explica a composição; não decide se a diferença é real.

### 7.6 Situações por conta (Padrões A e B)

| Situação sugerida | Quando |
|---|---|
| Sem diferença | diferença = 0 e nenhum achado de Erro ou Alerta |
| Com diferença — composição identificada | diferença ≠ 0, baixa do saldo anterior identificada (A) ou ponte sem parcela "não identificada" (B), e nenhum Erro |
| Com diferença — conferir | demais casos com diferença ≠ 0 |
| Erro de integração | qualquer F1a ou B1a |

As situações do papel de trabalho do usuário (`workpaperStatuses`) são escolhidas por ele em Justificativas; o módulo
nunca as preenche.

### 7.7 Texto do critério (padrão do usuário)

Por conta, em primeira pessoa, no estilo da aba 4 do papel de trabalho do usuário:

> Fizemos a comparação do saldo da conta com as verbas {lista "código descrição (R$ valor)"} da folha de
> pagamento de {mês/ano} (GPER040, {nível do escopo}), que somam R$ {esperado}. O saldo final do razão é de
> R$ {saldo} {D/C}. {Sem diferença: "Os valores são iguais e não há diferença." | Com diferença: "A diferença de
> R$ {dif} é composta por: {parcelas da ponte ≠ 0}."} {F3 identificada: "O saldo anterior (R$ {ant}) foi baixado
> em {datas} ({n} lançamentos)."}

Padrão B: ver 8.5. Sem adjetivos, sem materialidade, sem citar norma.

---

## 8. Padrão B — provisões de férias e 13º

### 8.1 Leitor S-3/S-4 — GPER070 e GPER090

Entrada: linhas de largura fixa (TXT normalizado por 4.1 ou PDF reconstruído). Um leitor, duas configurações
(`vacation`, `thirteenth`). Validado com o analítico real dos dois relatórios.

**Os valores são lidos por expressão regular, não por posição**: no TXT real as colunas numéricas variam ±2
posições em algumas linhas. Formato dos valores: `-?\d+,\d\d` (vírgula decimal, **sem** separador de milhar,
negativos existem). Números de dias (`D.Fer 30.0`, `Faltas 0.0`, `Saldo 30.0`) e `MESES nn` usam ponto ou são
inteiros e **não** são valores.

Tipos de linha (primeira que casar):

| Tipo | Regra |
|---|---|
| cabeçalho/separação | começa com `*`; ou só `-`, `#`, `*` |
| data-base | `Data Base: dd/mm/aaaa` (competência) |
| colaborador | `^FILIAL: (\d\d) CCTO: (\S+)\s+MAT: (\d+)\s+NOME: (.*?)\s+(DT\.BASE FER: \S+ )?SALARIO: \S+` (matrícula com 4 a 6 dígitos seguida de espaços; `DT.BASE FER` só nas férias) |
| dados do colaborador | contém `DATA ADMISSAO:`; o texto antes dele é um marcador (`CONGELADO`, `TRANSFERENCIA`); `DATA DEMISSAO` vazio = `/  /` |
| total de filial | `^FILIAL: (\d\d) - (.*)$` |
| total do grupo | `^Grupo de Empresas\s*: (.*)$` |
| seção (férias) | `^(VENCIDAS\|A VENCER\|TOTAL)\s+VALOR` — os títulos das colunas na mesma linha conferem com `columns` |
| títulos (13º) | `^\s*VALOR\s+ADICIONAIS\s+1o PARCELA` — seção única implícita `TOTAL` |
| linha de valores | termina com **exatamente 8** números `-?\d+,\d\d`; rótulo = texto antes do 1º número |
| fim | começa com o texto de fim do relatório configurado no perfil (`provisionReports.endMarker`; o texto real fica no perfil local, fora do git) |

Tipo da linha de valores pelo rótulo, nesta ordem: contém `No Mes-Baixa` → informativo (ignorar; só nos totais);
`Anter` → `ANTER`; `No Mes` → `NO_MES`; `Atual` → `ATUAL`; `Ferias` → `BX_FERIAS`; `Rescis` → `BX_RESCIS` (pode vir
sozinho na linha, continuação do rótulo "Valor Baixa"); `Entr.` → `TRANSF_ENTRADA`; `Saida` → `TRANSF_SAIDA`.
Rótulo sem tipo = linha desconhecida (P-8).

Regras de estrutura:
- O bloco do colaborador continua através da quebra de página (o cabeçalho de página aparece no meio do bloco); só
  um novo cabeçalho de colaborador ou de total encerra o bloco.
- Colaborador sem nenhuma linha de valores é válido (observado com `CONGELADO`).
- Férias: as seções presentes variam (VENCIDAS, A VENCER e TOTAL; só A VENCER; só VENCIDAS). **Total efetivo** do
  colaborador = seção TOTAL, se existir; senão, a única seção presente. Duas seções sem TOTAL: **não observado** →
  falha P-3.
- Linha de valores repetida (mesmo tipo) na mesma seção = erro de leitura (P-8).

Colunas (ordem; conferir com o cabeçalho):
- Férias: `VALOR`, `ADICIONAIS`, `1/3 CONSTIT.`, `TOTAL FERIAS`, `I.N.S.S.`, `F.G.T.S`, `TOT.ENCARGOS`, `TOTAL GERAL`.
- 13º: `VALOR`, `ADICIONAIS`, `1o PARCELA`, `TOTAL 13o`, `I.N.S.S.`, `F.G.T.S`, `TOT.ENCARGOS`, `TOTAL GERAL`.

### 8.2 Invariantes de leitura das provisões (bloqueiam)

| Código | Regra |
|---|---|
| P-1 | Toda linha de valores: férias `TOTAL FERIAS = VALOR + ADICIONAIS + 1/3`; 13º `TOTAL 13o = VALOR + ADICIONAIS − 1o PARCELA`; `TOT.ENCARGOS = INSS + FGTS`; `TOTAL GERAL = TOTAL + TOT.ENCARGOS`. Na amostra a 1ª parcela do 13º é zero: o sinal dela **não foi verificado**; se P-1 falhar só nisso, parar e perguntar. |
| P-2 | Toda seção com `ATUAL`: `ATUAL = ANTER + NO_MES − BX_FERIAS − BX_RESCIS + TRANSF_ENTRADA − TRANSF_SAIDA`, coluna a coluna (linha ausente = 0). |
| P-3 | Férias: quando existem VENCIDAS, A VENCER e TOTAL, `TOTAL = VENCIDAS + A VENCER` em todo tipo de linha. |
| P-4 | Total de filial = Σ dos totais efetivos dos colaboradores da filial (em cada tipo de linha e coluna). |
| P-5 | Total do grupo = Σ dos totais de filial (por seção e no total). |
| P-6 | Uma única `Data Base`; igual ao último dia da competência da sessão. |
| P-7 | No total do grupo, `TRANSF_ENTRADA = TRANSF_SAIDA` em todas as colunas. |
| P-8 | Nenhuma linha desconhecida dentro de um bloco; nenhuma linha de valores repetida na seção. |

Informativo entre relatórios: quantidade de colaboradores do GPER070, do GPER090 e de funcionários do GPER040
(no real, iguais).

### 8.3 Casamento com o razão (B1), por filial e linha da ponte

Para cada conta `provision`, com a coluna `column` do relatório:

| Linha da ponte | Relatório (total efetivo da filial) | Razão (linhas de integração da competência na conta, por `FILIAL CTB`) |
|---|---|---|
| Provisão do mês | `NO_MES` | Σ créditos − Σ débitos das verbas `accrual` |
| Baixa por férias | `BX_FERIAS` | Σ débitos − Σ créditos das verbas `vacationRelease` |
| Baixa por rescisão | `BX_RESCIS` | Σ débitos − Σ créditos das verbas `terminationRelease` |

| Código | Severidade | Exceção quando |
|---|---|---|
| B1a | Erro | Filial × linha da ponte com valores diferentes. |
| B1b | Alerta | Linha de integração na conta com verba fora das três listas. |
| B1c | Alerta | Débito de verba `accrual` sem `reversalMarker` no histórico, ou crédito com ele (no real, todo débito de provisão é estorno marcado). |
| B1d | Alerta | Linha de integração sem verba reconhecível. |
| B2 | Alerta | Saldo inicial da competência ≠ `ANTER` do grupo. |
| B3 | (diferença) | Saldo final ≠ `ATUAL` do grupo: diferença = `ATUAL` − saldo contábil; qualquer valor ≠ 0 é sinalizado (D-7). |

As transferências entre filiais (P-7) não geram lançamento; por isso B1 compara **movimentos** por filial, e o
**saldo** só no total do grupo. Referência real: as seis contas, todas as filiais e as três linhas da ponte iguais;
nenhum B1b, B1c ou B1d; diferença zero em todas.

### 8.4 Ponte do Padrão B

```
saldoContabil = ATUAL
              + (saldoInicialCompetência − ANTER)                           // B2
              + (provisão do mês: razão − relatório)                         // B1a
              − (baixa por férias: razão − relatório)                        // B1a
              − (baixa por rescisão: razão − relatório)                      // B1a
              + integração de verbas fora das listas                         // B1b
              + Σ movimentos da competência fora da integração, por classe de lote
              − (TRANSF_ENTRADA − TRANSF_SAIDA)                              // 0 quando P-7 vale
```

Identidade fecha em centavos (CC-3).

### 8.5 Texto do critério (Padrão B)

> Fizemos a comparação do saldo da conta com o saldo atual da coluna {coluna} do relatório de provisão de
> {férias | 13º salário} de {mês/ano} ({GPER070 | GPER090}, total do grupo de empresas), que é de R$ {ATUAL}. O saldo
> final do razão é de R$ {saldo} {D/C}. {sem diferença | composição}. Conferimos a movimentação do mês, partindo do
> saldo anterior de R$ {ANTER}: a provisão do mês (R$ {NO_MES}) corresponde às verbas {accrual} lançadas a crédito,
> líquidas dos estornos "{marcador}" lançados a débito; {a baixa por férias gozadas (R$ …) corresponde às verbas …;}
> a baixa por rescisão (R$ {BX_RESCIS}) corresponde às verbas {terminationRelease}. As transferências entre filiais
> (R$ {entrada} de entrada e R$ {saída} de saída) se anulam no total do grupo e não geram lançamento contábil.

---

## 9. Tela

Fluxo da plataforma: Arquivos → Processamento → Reconciliação de leitura → visões. Trilho: **Reconciliação ·
Painel · Achados · Tabelas · Justificativas · Exportação** (via `features`).

- **Reconciliação de leitura:** por arquivo: relatório e formato detectados, SHA-256, codificação, linhas, blocos,
  colaboradores/funcionários, escopos de totalização, competência, intervalo e tipo de saldo do razão, e o quadro de
  invariantes (L, R, P, V) com OK/falha.
- **Painel:** uma linha por conta: tick mark, conta, nome, padrão (A/B), esperado, saldo contábil, diferença,
  situação sugerida, baixa (A). Indicadores-chave (≤ 7): Contas, Sem diferença, Com diferença, Erros de integração,
  Verbas sem integração (F1c), Linhas de integração conferidas, Competência.
- **Achados:** Erro (F1a, B1a), Alerta (F1b–F1d, B1b–B1d, B2, T1, T3), Informativo (F1e, F3 não
  identificada/ambígua, linhas fora da competência, T2). Toda diferença ≠ 0 aparece, sem filtro de valor.
- **Painel lateral da conta:** critério, ponte (7.5 ou 8.4) com os lançamentos de cada parcela, baixa do saldo
  anterior (A), quadro por filial (B), texto do critério com botão copiar.
- **Tabelas:** Folha (escopo × verba), Provisões (filial × linha × coluna), Integração (chave × folha/provisão ×
  razão × diferença × situação), Razão (linhas com classe de lote e marca de baixa), Contas.

## 10. Planilha exportada (tudo por fórmula)

Gerador próprio (`src/worker/export/`), fontes Aptos/Aptos Display, regras da seção "Planilha exportada" do
`CLAUDE.md`.

| Aba | Conteúdo | Amarração |
|---|---|---|
| Resumo | por conta: padrão, esperado, saldo real, saldo em pré-lançamento, saldo contábil combinado, diferença, situação, baixa | `SUMIFS` sobre as abas abaixo |
| Criterios | por conta: verbas, sinais, colunas, texto do critério | dados de configuração |
| Folha_Escopo | verba × valor no escopo; proventos, descontos, líquido | = rodapé lido (L-2/L-3) |
| Folha_Filial | filial × verba | Σ filiais = Folha_Escopo (L-5) |
| Provisoes | relatório × filial × linha da ponte × 8 colunas; total do grupo | Σ filiais = grupo (P-5); ponte por linha (P-2) |
| Integracao | chave × folha ou provisão × razão × diferença × código do achado | `SUMIFS` sobre Razao, Folha_Filial e Provisoes |
| Razao | linhas da competência das contas do perfil: tipo de saldo, classe de lote, verba, valor na natureza, "Baixa do saldo anterior?" (Sim/Não) | saldo final = saldo inicial + Σ, por tipo e combinado (R-1) |
| Ponte | por conta, as parcelas de 7.5 ou 8.4 | Σ parcelas = saldo contábil (CC-3) |
| Rastreabilidade | comum + parâmetros do razão + formato e versão do leitor de PDF | — |

Valores em número, datas como serial, indicadores Sim/Não, nenhuma mesclagem sobreposta, `IF(INDEX(...)="","",…)` em
toda busca.

## 11. Invariantes do motor

| Código | Regra |
|---|---|
| CC-1 | Toda conta do perfil com fonte carregada existe no razão (senão: aviso e conta fora da análise). |
| CC-2 | Toda linha da competência de uma conta do perfil está em exatamente uma parcela da ponte. |
| CC-3 | A identidade da ponte (7.5 ou 8.4) fecha em centavos, conta a conta. |
| CC-4 | Σ das chaves F1/B1 do lado do razão = movimento de integração considerado; do lado da origem = esperado (A, `verbas`) ou linha da ponte do grupo (B). |
| CC-5 | Mesma entrada + mesma configuração = mesma saída, qualquer que seja o formato de entrada (V-2). |
| CC-6 | Planilha recalculada: todas as linhas do Resumo "Confere". |

## 12. Pendências de insumo (o executor não pode preencher)

| ID | Falta | Bloqueia |
|---|---|---|
| P-1 | Razão exportado em XLSX direto do Protheus, se essa exportação existir | só o adaptador XLSX (5.4) |
| P-2 | Razão original (qualquer formato) das demais contas do perfil, no mês do golden | nada; troca a cópia do papel de trabalho nos testes locais |
| P-3 | Razão com continuação de histórico (histórico de mais de 40 caracteres) | confirmação da regra de continuação (5.2, 5.3) |
| P-4 | Provisão de 13º com 1ª parcela ≠ 0 (novembro ou dezembro) | confirmação do sinal em P-1 |
| P-5 | Balancete do período | conferência cruzada opcional (S-5) |
| P-6 | Razão de uma mesma conta em tipo 1 e em tipo 9, com o **mesmo intervalo** e cobrindo um mês inteiro (depois do fechamento do mês, antes da efetivação) | golden local da visão combinada (5.7); a regra não depende dele |

## 13. Decisões

- **D-1 (16/11/2026):** um módulo com perfis; Folha primeiro; depois bancos, clientes, fornecedores e adiantamentos.
- **D-2 (19/11/2026, revisada 23/11):** formatos por relatório conforme seção 3. Razão: TXT, XML e PDF validados; XLSX
  quando houver amostra.
- **D-3 (19/11/2026):** todo relatório aceita qualquer formato exportado com texto selecionável, por adaptador, com as
  mesmas invariantes. Para a folha e as provisões, TXT e PDF.
- **D-4:** substituída pela D-7.
- **D-5 (19/11/2026):** estorno de provisão = débito da verba de provisão com marcador `NEG` no histórico (confirmado
  no razão real e na documentação do usuário); exceção vira B1c.
- **D-6 (19/11/2026):** aprovada a dependência `pdfjs-dist`, empacotada, sem rede (3.3).
- **D-7 (19/11/2026):** o Conciliador sinaliza qualquer diferença a partir de R$ 0,01; o limite de materialidade do
  papel de trabalho não se aplica ao módulo.
- **D-8 (23/11/2026):** filial do razão para casamento = `FILIAL CTB`.
- **D-9 (23/11/2026):** Padrão B faz parte do perfil Folha (`mode: 'provision'`); contas sem o relatório de origem na
  sessão ficam "não analisadas".
- **D-10 (23/11/2026):** o tipo de saldo de um razão é o do parâmetro 06 da extração. Razão real (1) e pré-lançamento
  (9) da mesma conta são combinados (5.7). Saldo anterior do pré-lançamento ≠ 0 é sinalizado sem bloquear (T1), porque
  pode ser saldo antigo.

## 14. Perfis futuros (não implementar agora)

Bancos (extrato × razão: chave documento/valor, depois valor + data com janela, depois subconjunto), clientes e
fornecedores (posição de títulos × razão, por participante), adiantamentos (posição × razão, com prazo). Todos usam
`formats/`, `match/` e `bridge.ts`; cada um terá a sua seção antes de começar.
