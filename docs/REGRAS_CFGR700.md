# Regras de negócio — log de auditoria CFGR700 (tabela CT2)

Especificação da lógica já validada contra entregas reais. Qualquer divergência entre esta especificação e o
código é um defeito no código, salvo decisão registrada aqui.

---

## 1. O arquivo de entrada

Arquivo `.xlsx` gerado pelo relatório CFGR700 do Protheus. Estrutura observada:

| Parte do ZIP | Conteúdo | Tamanho típico |
|---|---|---|
| `xl/workbook.xml` + rels | Duas abas: `Parametros` e `15-01 - Relatório de auditoria` | pequeno |
| `xl/sharedStrings.xml` | Tabela de strings compartilhadas; ~30 a 45 mil strings únicas | 1–2 MB descomprimido |
| aba de parâmetros | Pares "Pergunta NN : texto ?" → valor, mais Dt.Ref, Hora, Emissão | pequeno |
| aba do relatório | ~600 mil a ~1 milhão de linhas, 10 colunas | 230–360 MB descomprimido (22–34 MB no ZIP) |

Observações:
- Quase todas as células são `t="s"` (índice na sharedStrings). A coluna Recno vem como número (`<v>` sem `t`).
- Resolver as abas pelo `workbook.xml` + `workbook.xml.rels` (nome da aba → arquivo). Não assumir `sheet2.xml`.
- A tag `<dimension ref="A1:J960516"/>` informa o total de linhas: usar para pré-alocar os typed arrays e para
  calcular o progresso. Se ausente, crescer em blocos.
- **Linhas podem não existir no XML** (lacunas no atributo `r`). Linhas ausentes contam como linhas em branco.
- sharedStrings: um `<si>` pode ter texto simples (`<t>`) ou vários trechos (`<r><t>`); concatenar todos os
  `<t>` e ignorar `<rPh>`. Decodificar entidades XML e escapes `_xHHHH_`.

### Colunas do relatório (localizar pelo texto do cabeçalho, não pela posição)

`Campo`, `Vlr Antigo`, `Vlr Atualizado`, `Tipo Dados`, `Recno`, `Usuario`, `Operacao`, `Data Hora`, `Situacao`,
`Tipo Dado Protegido`.

### Classificação das linhas da aba do relatório

- Linha 1: primeiro cabeçalho (`Campo` na coluna A).
- **Cabeçalho repetido**: coluna A = `Campo` (o relatório repete o cabeçalho a cada página).
- **Linha em branco**: coluna A vazia (inclui linhas ausentes no XML).
- **Linha de detalhe**: todas as demais.

Reconciliação obrigatória, exibida na tela e gravada na exportação:
`linhas após o 1º cabeçalho − cabeçalhos repetidos − linhas em branco = linhas de detalhe`.

Decisões de leitura (Fase 1):
- **Total de linhas da planilha** = maior entre a última `<row>` do XML e a última linha do `<dimension>`.
  Se o `<dimension>` for além da última `<row>`, as linhas finais contam como ausentes no XML (em branco) e a
  diferença aparece como alerta informativo.
- **Linha com `Campo` vazio e outras colunas preenchidas** conta como em branco (a regra é pela coluna A);
  a quantidade é exibida à parte na reconciliação.
- **Recno** como número ou como texto só com dígitos é aceito. Recno não numérico, `Operacao` fora das quatro
  operações configuradas, `Data Hora` inválida e referência a string compartilhada inexistente são contados por
  arquivo e fazem falhar o invariante "Valores legíveis" (seção 11).
- A primeira linha da aba precisa conter todos os cabeçalhos configurados; senão a leitura é interrompida.
- O CRC32 e o tamanho de **todas** as entradas do ZIP são conferidos; qualquer divergência interrompe a leitura.

### Aba de parâmetros

Ler e exibir todos os pares. Validar e alertar se:
- Tabela início/fim ≠ tabela configurada (CT2).
- Operações de inclusão, alteração, exclusão ou recuperação ≠ `Sim`.
- `Exclui campos não alterados` ≠ `Sim` (as regras abaixo pressupõem `Sim`).
- Datas inicial/final: exibir; comparar com o primeiro e o último evento efetivamente gravados.

**Atenção:** o filtro de data do CFGR700 é pela **data do evento**, não pela data contábil do lançamento.

---

## 2. Valores monetários e datas

- `CT2_VALOR` vem como texto com ponto decimal (`1234567.89`). Converter para centavos inteiros.
- `Data Hora` no formato `dd/mm/aaaa hh:mm:ss`; `CT2_DATA` no formato `dd/mm/aaaa`. Parse manual, sem fuso.
- Parsear cada string de data uma única vez (cache por id do dicionário).

---

## 3. Várias extrações

O usuário pode carregar mais de um arquivo (ex.: 15–31/08 e 01–04/09). Regras:
- Cada arquivo recebe um índice de fonte (ordem de carregamento) e mantém suas próprias contagens de reconciliação.
- Os detalhes são unidos numa só base; `ord` é um contador global crescente na ordem de leitura (arquivo 1 inteiro,
  depois arquivo 2...).
- Alertar se os intervalos de evento se sobrepõem ou se há intervalo descoberto entre eles (dias úteis).
  Dias úteis = segunda a sexta, sem calendário de feriados; o alerta lista as datas descobertas.
- A informação de um arquivo completa registros do outro (ex.: exclusão em setembro revela os dados de um registro
  que em agosto só aparecia por alteração).

---

## 4. Eventos

Um **evento** é o conjunto de linhas de detalhe com o mesmo `(Recno, Operacao, Usuario, Data Hora)`.
Para agrupar, ordenar por `(Recno, dataHora, Operacao, Usuario, ord)` e agrupar os consecutivos iguais.
(Inclusão e Recuperação costumam ocorrer no mesmo segundo para o mesmo Recno: por isso Operacao entra na ordenação.)

Usuário vazio no log é substituído pelo rótulo `(sem usuário no log)` (ocorre em rotinas executadas no servidor).

Operações: `Inclusão`, `Alteração`, `Exclusão`, `Recuperação`.

Na base consolidada (vários arquivos), linhas de arquivos diferentes com a mesma chave formam um único evento;
nas contagens por arquivo, cada arquivo é agrupado separadamente. **A confirmar** contra o `golden.json`
consolidado quando os dois arquivos estiverem disponíveis.
- Recuperação grava valor anterior igual ao atualizado e não é alteração; não entra nas categorias.
- Um mesmo Recno pode ter mais de uma Inclusão (a gravação ocorre em etapas); usar a primeira.
- Um mesmo Recno pode ter duas Exclusões no mesmo segundo; tratar como um evento de exclusão (usar a última).

---

## 5. Registros (estado de cada Recno)

Para cada `(Recno, Campo)` com Campo na lista `keepFields`, o valor do registro é o **último** valor na ordem
`(Recno, dataHora, ord)`, onde valor = `Vlr Antigo` se a operação é Exclusão, senão `Vlr Atualizado`.

`keepFields` (CT2): CT2_DATA, CT2_LOTE, CT2_SBLOTE, CT2_DOC, CT2_LINHA, CT2_MANUAL, CT2_VALOR, CT2_DEBITO,
CT2_CREDIT, CT2_DC, CT2_HIST, CT2_ROTINA, CT2_LP, CT2_ORIGEM, CT2_INCONS, CT2_TPSALD, CT2_ESTCAN, CT2_MOEDLC,
CT2_CCD, CT2_CCC, CT2_ITEMD, CT2_ITEMC.

Recno que aparece no log apenas com campos fora de `keepFields` (ex.: só CT2_USERGA) **também vira registro**,
sem documento, origem ou valor.

Atributos derivados por registro:

| Atributo | Regra |
|---|---|
| excluido | existe evento de Exclusão |
| incluido | existe evento de Inclusão |
| alterado | existe evento de alteração efetiva (seção 6) |
| origem | CT2_MANUAL 1 = Manual; 2 = Automático; vazio = Não identificado |
| natureza | CT2_DC 1 Débito; 2 Crédito; 3 Débito e Crédito; 4 Complemento de histórico |
| tipo de linha | DC 4 = Complemento; DC 1/2/3 = Contábil; outro = Indefinido |
| débito / crédito | débito = valor se DC ∈ {1,3}; crédito = valor se DC ∈ {2,3}; DC 4 não tem valor |
| usuário/data de inclusão | do primeiro evento de Inclusão |
| usuário/data de exclusão | do último evento de Exclusão |
| qtde alterações | número de eventos de alteração efetiva |
| chave do documento | `CT2_DATA|CT2_LOTE|CT2_SBLOTE|CT2_DOC` se origem identificada; senão `SEM IDENTIFICACAO` |
| inconsistência | CT2_INCONS na inclusão = 1 e valor final = 1 → "pendente"; na inclusão = 1 e final ≠ 1 → "corrigido"; senão "Não" |

---

## 6. Critério de corte das alterações

Campos de ruído (`noiseFields`): `CT2_TPSALD`, `CT2_USERGA`.

Para cada evento de Alteração, `ef` = campos do evento que não são ruído.

| Tipo | Regra | Tratamento |
|---|---|---|
| Efetivação do tipo de saldo (9 → 1) | `ef` vazio e o evento contém CT2_TPSALD | Descartado |
| Somente carimbo de usuário (CT2_USERGA) | `ef` vazio e não contém CT2_TPSALD | Descartado |
| Alteração efetiva | `ef` não vazio | Considerado |

Invariantes:
- Todas as ocorrências de CT2_TPSALD em alterações devem ser `9 → 1`. Qualquer outra transição é alerta.
- `descartados + efetivos = total de eventos de Alteração`, por arquivo e no total.

Aba "Alteracoes" da exportação: uma linha por **campo** alterado (não por evento), apenas campos fora do ruído.

---

## 7. Documentos

Agrupar registros identificados pela chave do documento. Por documento:

| Coluna | Regra |
|---|---|
| Linhas contábeis / de complemento | contagem por tipo de linha |
| Linhas excluídas / alteradas | contagem |
| Débito/crédito registrado | soma de todas as linhas |
| Débito/crédito vigente | soma das linhas não excluídas |
| Origem | Manual, Automático, ou **Misto** se houver as duas |
| Base de avaliação | Parcial se alguma linha não tem Inclusão no log; senão Completa |
| Excluído | Não (0 linhas), Total (todas as linhas), Parcial |
| Desbalanceado | Não avaliável se base Parcial; Sim se |débito − crédito| ≥ R$ 0,01 (registrado ou vigente); senão Não |
| Data da 1ª exclusão / última exclusão | mín./máx. das datas de exclusão das linhas |
| Data da última alteração efetiva | **uma coluna por arquivo de origem**: máx. da data das alterações efetivas daquele arquivo |
| Data da 1ª postagem | mín. da data de inclusão das linhas |

Ordenação: por data do lançamento, lote, sublote, documento. Na Base_Linhas, os registros de um documento ficam
contíguos (as fórmulas do Excel usam o intervalo inicial–final de cada documento).

---

## 8. Categorias do painel e filtro de período

O filtro usa a **data do evento**. Presets configuráveis + período personalizado.

| Categoria | Lançamentos no período | Documentos no período |
|---|---|---|
| Excluído | data da exclusão da linha no período | data da **1ª** exclusão do documento no período |
| Alterado | data da alteração (coluna de qualquer arquivo) no período — soma das colunas | idem, por documento |
| Desbalanceado | linha de documento desbalanceado com inclusão no período | documento desbalanceado com 1ª postagem no período |
| Postado | data de inclusão no período | data da 1ª postagem no período |

Regras de alocação (decisões registradas):
- Exclusões e postagens: o documento é contado no período do seu **primeiro** evento, para não contar duas vezes
  (ex.: documento com exclusões em 19/08 e 26/08 conta só em 17–24/08).
- Alterações: **cada arquivo de origem tem sua própria data**. Um registro alterado nos dois arquivos aparece
  nos dois períodos; a soma dos períodos é igual ao total.
- Valores: "valor debitado" = soma dos débitos das linhas da categoria.
- Colunas por origem: Manual, Automático; documentos Mistos em coluna própria; total de documentos inclui todos.
- Registros "Não identificado" não entram nas colunas Manual/Automático; aparecem na sinalização e no quadro de competência.

### Composição por data contábil
Para o período filtrado, separar lançamentos, documentos e valor por data contábil ≤ data de corte
(configurável, ex.: último dia do mês de fechamento) e > data de corte, mais "Sem identificação".

### Sinalizações (configuráveis: rótulo, se exige ação, texto da situação)
- Documentos desbalanceados (ação).
- Documentos excluídos ou alterados sem justificativa (ação).
- Registros alterados sem identificação de documento (informativo).
- Lançamentos gravados como inconsistentes (informativo; ação se algum "pendente").
- Lançamentos incluídos sem usuário no log (informativo).
- Dias úteis do período sem nenhum evento (ação).

Redação das situações: neutra e factual (ex.: "3 documento(s) com justificativa pendente"), sem verbos como
"investigar" ou "requer".

---

## 9. Justificativas

- Vinculadas pela chave do documento, separadas em exclusão e alteração.
- Listas: todo documento com linha excluída; todo documento com linha alterada efetivamente.
- Importação: ler justificativas de uma exportação anterior (abas "Justificativa da Exclusao" e
  "Justificativa da Alteração", chave na coluna A, texto na coluna "Justificativa ...") ou de JSON.
- Documento que já tinha justificativa e voltou a ser movimentado em outro arquivo: sinalizar para o usuário
  confirmar se a justificativa cobre o novo evento; permitir marcar "abrange o novo evento".
- Cobertura por período = documentos com justificativa / documentos no período, por categoria.
- Na exportação: células vazias destacadas por formatação condicional (não por preenchimento fixo), e observação
  "Justificativa pendente" por fórmula, para sumirem quando o usuário preencher no Excel.

---

## 10. Limitações a declarar na exportação

- O log só contém o que foi movimentado no intervalo extraído; não é a população da razão.
- Com "Exclui campos não alterados = Sim", alterações trazem só o campo modificado. Consequências:
  documentos de base parcial ("Não avaliável") e registros "Não identificado" (lançados antes do início do log e
  só alterados). Para estes, informar quantos tiveram alteração de conteúdo, só efetivação e só carimbo.
- Registros "Não identificado" podem ser associados a documentos consultando a CT2 pelo Recno.

---

## 11. Invariantes (todos verificados a cada execução)

1. Reconciliação de linhas por arquivo (seção 1).
2. Eventos por operação somam o número de eventos distintos.
3. Alterações: descartados + efetivos = total, por arquivo.
4. CT2_TPSALD: 100% das transições são 9 → 1.
5. Registros de cada documento contíguos na base de linhas.
6. Soma de lançamentos por período (presets que particionam o log) = total do log completo.
7. Totais do quadro de competência = totais das categorias + não identificados.
8. CRC32 e tamanho de cada entrada do ZIP conferem com o diretório central.
9. Nenhuma data exportada anterior a 1901 ou vazia convertida em zero.
10. Nenhuma mesclagem sobreposta na exportação.
11. Valores legíveis: nenhuma linha de detalhe com Recno inválido, operação não reconhecida, Data Hora inválida
    ou referência a string compartilhada inexistente (seção 1).

Implementados na Fase 1: 1, 2, 8 e 11. Os alertas de parâmetros (seção 1) e de cobertura entre extrações
(seção 3) aparecem como verificações de nível "alerta", que não bloqueiam a exportação.
