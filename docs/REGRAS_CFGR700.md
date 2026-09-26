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
  **Decisão registrada (Fase 2):** formatos aceitos são inteiro (`1234`) e até duas casas decimais com ponto
  (`1234.56`); espaços nas pontas são ignorados. Valor vazio é esperado só em registros "Não identificado":
  ficam sem valor e não falham nenhum invariante. Qualquer outro formato (vírgula, mais de duas casas, texto não
  numérico, sinal) ou valor vazio em registro identificado é **ilegível**: conta no invariante 11 e bloqueia a
  exportação. Nunca arredondar nem corrigir silenciosamente.
- `Data Hora` no formato `dd/mm/aaaa hh:mm:ss`; `CT2_DATA` no formato `dd/mm/aaaa`. Parse manual, sem fuso.
- Parsear cada string de data uma única vez (cache por id do dicionário).

---

## 3. Várias extrações

O usuário pode carregar mais de um arquivo (ex.: 15–31/08 e 01–04/09). Regras:
- Cada arquivo recebe um índice de fonte (ordem de carregamento) e mantém suas próprias contagens de reconciliação.
- Os detalhes são unidos numa só base; `ord` é um contador global crescente na ordem de leitura (arquivo 1 inteiro,
  depois arquivo 2...).
- Alertar se os intervalos de evento se sobrepõem ou se há intervalo descoberto entre eles (dias úteis).
  Dias úteis = segunda a sexta, exceto os feriados da configuração (seção 8); o alerta lista as datas descobertas.
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
nas contagens por arquivo, cada arquivo é agrupado separadamente. Confirmado contra o `golden.json` consolidado.
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
| partidas excluídas | registros com evento de Exclusão, **de qualquer tipo de linha** (inclui complemento de histórico, DC 4) |

Decisões registradas (Fase 2):
- **CT2_INCONS "na inclusão"**: primeiro valor de CT2_INCONS nas linhas de Inclusão, em ordem cronológica
  (data/hora do evento e, no mesmo segundo, ordem de leitura). Vale também quando a inclusão é gravada em etapas.
- **Partidas excluídas** (número comparado com o `golden.json`): todos os registros com evento de Exclusão,
  inclusive linhas de complemento de histórico. As linhas contábeis excluídas são exibidas à parte, como detalhe.
- Primeira Inclusão e última Exclusão: por data/hora do evento e, no mesmo segundo, pela ordem de leitura.
- Débito e crédito usam o valor final do registro; linha com valor ilegível entra com zero (e o invariante 11 falha).

---

## 6. Critério de corte das alterações

Campos de ruído (`noiseFields`): `CT2_TPSALD`, `CT2_USERGA`.

Para cada evento de Alteração, `ef` = campos do evento que não são ruído.

| Tipo | Regra | Tratamento |
|---|---|---|
| Efetivação do tipo de saldo (9 → 1) | `ef` vazio e o evento contém CT2_TPSALD, com todas as transições `9 → 1` | Descartado |
| Somente carimbo de usuário (CT2_USERGA) | `ef` vazio e não contém CT2_TPSALD | Descartado |
| Alteração efetiva | `ef` não vazio, **ou** CT2_TPSALD com transição diferente de `9 → 1` | Considerado |

**Decisão registrada (Fase 2):** só a transição `9 → 1` de CT2_TPSALD é descartada como efetivação. Qualquer
outra transição é tratada como campo alterado: o evento é "Alteração efetiva", a linha de CT2_TPSALD entra na aba
Alteracoes e o registro entra nas contagens de alterados do painel. Além disso, gera um alerta não bloqueante
("Outras transições do tipo de saldo"), com a quantidade por arquivo.

Invariantes:
- Todo evento descartado como efetivação tem CT2_TPSALD `9 → 1` (vale por construção da classificação acima).
- `descartados + efetivos = total de eventos de Alteração`, por arquivo e no total.

Aba "Alteracoes" da exportação: uma linha por **campo** alterado (não por evento), apenas campos fora do ruído,
mais as linhas de CT2_TPSALD com transição diferente de `9 → 1`.

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

"Desbalanceados de base completa" (comparado com o `golden.json`) = documentos com Desbalanceado = Sim, o que
já pressupõe base Completa.

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

### Decisões registradas (Fase 3)

**Os números do painel só são considerados validados depois que a Fase 2 passar no `golden.json` com os dois
arquivos** (agosto sozinho, setembro sozinho, consolidado e todos os painéis). O teste local compara com o golden o
painel exatamente como é servido à tela (`Session.panel`). Com um arquivo só, o teste local confere a consistência
interna nos dados reais: cada número do painel é igual ao total da tabela aberta por ele, em todos os presets, e a
composição fecha.

- **Atalhos de período** gerados a partir dos arquivos carregados: "Log completo" (do primeiro ao último evento do
  escopo); um por extração, com o intervalo pedido nos parâmetros do arquivo (na falta, do primeiro ao último evento
  do arquivo); e "Personalizado". O usuário pode salvar atalhos próprios (nome + período), guardados na configuração
  (`panel.periodPresets`) em IndexedDB neste computador. **Nenhum recorte fixo no padrão.**
- **Data de corte da competência:** padrão = último dia do mês do primeiro evento do escopo. Exibida e editável no
  painel; o valor usado é guardado na sessão e gravado na aba Rastreabilidade da exportação (Fase 5).
- **Composição por data contábil:** linhas pela CT2_DATA do registro; documentos pela CT2_DATA do documento.
  Linhas identificadas com CT2_DATA ilegível aparecem numa coluna própria ("Data contábil ilegível").
- **Período × demais dias × log completo:** demais dias = log completo − período, categoria por categoria.
- **Feriados:** lista editável na configuração (`calendar.holidays`, dd/mm/aaaa; vazia por padrão), guardada em
  IndexedDB. Feriados não contam como dias úteis nas sinalizações nem nos alertas de cobertura entre extrações
  (seção 3; estes valem a partir da análise seguinte à mudança).
- **Sinalizações, calculadas sobre o período selecionado:**
  - Documentos desbalanceados: documentos da categoria Desbalanceado no período.
  - Sem justificativa: documentos distintos das categorias Excluído ou Alterado no período sem justificativa.
    Enquanto as justificativas não forem carregadas (Fase 4), todos aparecem como pendentes e o painel mostra um
    aviso de que isso não é um resultado da análise.
  - Alterados sem identificação: registros não identificados distintos com alteração efetiva no período.
  - Inconsistentes: lançamentos postados no período com inconsistência "pendente" ou "corrigido"; exige ação só se
    houver algum pendente.
  - Sem usuário: lançamentos postados no período cuja inclusão não tem usuário no log.
  - **Dias sem cobertura de extração** (exige ação): dias do período, de qualquer dia da semana, fora do intervalo
    pedido nos parâmetros de todos os arquivos do escopo. Listados em intervalos (ex.: "15/08/2026 a 16/08/2026").
    No "Log completo", o exame vai do primeiro ao último dia conhecido (parâmetros e eventos).
  - Dias úteis sem evento (exige ação): dias úteis (segunda a sexta, exceto feriados) do período, cobertos por
    alguma extração, sem nenhum evento de qualquer operação.
- **Movimento diário:** por dia, as linhas contadas em Postado, Excluído e Alterado (alterações por arquivo) e o
  número de eventos distintos do dia.
- **Tabelas abertas pelo painel:** têm exatamente o número clicado. Na categoria Alterado, a tabela tem uma linha
  por (registro, arquivo) ou (documento, arquivo), com a coluna "Arquivo da alteração".

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

### Decisões registradas (Fase 4)

- **Uma justificativa por documento e por tipo** (exclusão, alteração). Um documento com exclusão e alteração
  aparece nas duas listas; a tela oferece "copiar da outra lista". Campo opcional **Responsável**.
- **Cobertura:** cada justificativa guarda os arquivos (nomes) e o último evento que cobre. Justificativa nova feita
  na tela cobre os arquivos em que o documento tem movimento daquele tipo e o último desses eventos.
- **Situação** de cada documento, por tipo: *Pendente* (sem texto); *Justificado*; *Movimentado após a justificativa*
  — o documento tem exclusão (ou alteração efetiva, conforme o tipo) num arquivo não coberto, depois do último evento
  coberto. "Abrange o novo evento" estende a cobertura aos arquivos e ao último evento atuais. Na sinalização
  "sem justificativa" e na cobertura do painel, *movimentado* conta como pendente até a confirmação.
- **Cobertura por período** (painel): documentos distintos das categorias Excluído e Alterado do período (mesma
  regra de alocação), por situação; cobertura = justificados ÷ documentos do período.
- **Importação de uma exportação anterior** (abas "Justificativa da Exclusao" e "Justificativa da Alteração"; cabeçalho
  com uma coluna "Justificativa …" além da coluna A; chave na coluna A; opcionais "Responsável" e "Observação"). A
  cobertura é deduzida da planilha: (a) arquivos listados na aba Rastreabilidade (comparados pelo nome, sem
  diferenciar maiúsculas); (b) sem Rastreabilidade, arquivos cujo primeiro evento é anterior ou igual à data do último
  evento encontrada nas colunas de data de evento de Documentos ou Base_Linhas (exclusão, alteração, inclusão,
  postagem; datas contábeis ignoradas; data sem hora vale até o fim do dia; datas seriais do Excel aceitas). O usuário
  pode alterar a escolha na tela. A observação contendo **"abrange o novo evento"** marca a cobertura como confirmada
  (todos os arquivos carregados).
- **Importação de JSON** exportado pela ferramenta: cada justificativa traz sua cobertura. Lista simples de
  {documentKey, kind, text} também é aceita (cobertura escolhida na tela).
- **Conflitos:** documento que já tem outro texto — mantém o atual e lista os conflitos com os dois textos lado a lado,
  com "substituir" por item ou todos. Diferenças só de espaços e quebras de linha não são conflito.
- **Chaves inexistentes no log atual:** guardadas, não descartadas; voltam a valer quando os arquivos
  correspondentes forem carregados. A tela informa quantas são.
- **Guarda:** IndexedDB neste computador. A tela mostra a data da última cópia em JSON e avisa quando há alterações
  sem cópia (os dados do navegador podem ser apagados).
- **Fase 5 (exportação):** gravar, para cada justificativa, a cobertura — arquivos e último evento cobertos — além
  do texto, do responsável e da situação, para que a importação de uma exportação futura recupere a cobertura exata.

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
4. CT2_TPSALD: todo evento descartado como efetivação do tipo de saldo tem transição 9 → 1 (vale por construção;
   transições diferentes são alteração efetiva e geram alerta não bloqueante — seção 6).
5. Registros de cada documento contíguos na base de linhas.
6. Soma de lançamentos por período (presets que particionam o log) = total do log completo.
7. Totais do quadro de competência = totais das categorias + não identificados.
8. CRC32 e tamanho de cada entrada do ZIP conferem com o diretório central.
9. Nenhuma data exportada anterior a 1901 ou vazia convertida em zero.
10. Nenhuma mesclagem sobreposta na exportação.
11. Valores legíveis: nenhuma linha de detalhe com Recno inválido, operação não reconhecida, Data Hora inválida
    ou referência a string compartilhada inexistente (seção 1).

Implementados: 1, 2, 8 e 11 (Fase 1); 3, 4, 5 e 6 (Fase 2); 7 (Fase 3: log completo com a data de corte padrão,
por escopo, na reconciliação; e para o período e o corte escolhidos, como indicador no painel). Todos verificados
por arquivo e no consolidado.
- Verificações de nível "alerta", que não bloqueiam a exportação: outras transições de CT2_TPSALD (seção 6),
  parâmetros do relatório (seção 1) e cobertura entre extrações (seção 3).
- Invariante 6: o log é particionado em dias (do primeiro ao último evento); a soma dos dias deve ser igual ao
  log completo em todas as categorias, colunas (lançamentos, documentos, valor) e origens.
- Invariante 11 inclui, desde a Fase 2, CT2_VALOR ilegível (seção 2).
