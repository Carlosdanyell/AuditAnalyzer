# Fase 15 — Conciliador: módulo novo e perfil Folha (Padrão A)

Descrição de execução para o Claude Code. Base: versão 2.4.0 (commit `b809365`; numeração ajustada em 23/11/2026, porque 2.3.0 e 2.4.0 já foram usadas). Leia antes, nesta ordem:
`CLAUDE.md`, `docs/MODULOS.md`, **`docs/REGRAS_CONCILIADOR.md`** (regras deste módulo; é a referência de tudo
abaixo), `docs/ARQUITETURA.md` (leitura em fluxo, worker, exportação) e `docs/INTERFACE.md`. Todas as restrições do
`CLAUDE.md` continuam valendo; em especial: **repositório público sem dados reais**, centavos inteiros,
determinismo, nada sai da máquina.

**Revisão de 23/11/2026:** razão em TXT e XML (não mais XLSX), filial do casamento = `FILIAL CTB`, razão com mais de
um mês, qualquer diferença sinalizada, estrutura `formats/` + `reports/`, e razão real (tipo 1) + pré-lançamento
(tipo 9) combinados (seção 5.7 das regras). Se alguma etapa já foi feita pela versão
anterior, ajuste-a a estas regras antes de seguir (mostre o que muda e confirme comigo).

---

## 1. Objetivo

Entregar o módulo `reconciliation` com o perfil Folha, Padrão A: ler o GPER040 em TXT e o razão em TXT ou XML, calcular o
esperado de cada conta, conferir a integração verba × filial, identificar a baixa do saldo anterior, montar a ponte
até o saldo contábil e exportar o papel de trabalho amarrado por fórmulas.

Fora desta fase (vão para a Fase 16): Padrão B (provisões) e o adaptador de PDF. Fora das duas: razão em XLSX
(sem amostra), outros perfis, balancete. Prepare as fronteiras (`formats/`, `reports/`) para receber o PDF sem
retrabalho, mas não crie nada dele.

## 2. O que já está validado (não reabrir sem motivo)

As regras das seções 4 e 7 de `REGRAS_CONCILIADOR.md` foram reproduzidas em protótipo sobre um mês real fechado:
- leitura completa com as invariantes L-1 a L-6 sem falha;
- os esperados por conta iguais, ao centavo, aos saldos-suporte do papel de trabalho manual do usuário;
- todas as linhas de integração do razão iguais à folha na chave verba × filial; os F1c da conta `netPay` são as
  verbas que o usuário lançou manualmente;
- as diferenças esperado − contábil iguais às da capa do usuário em todas as contas.

Os números ficam no golden local (seção 6.3). Se o código não chegar a eles, o erro está no código ou numa regra mal
lida — **investigue caso a caso antes de mudar qualquer regra** (seção 8).

## 3. Erros já cometidos no protótipo (evite)

1. Tratar toda linha `Empresa:` como cabeçalho de contexto: o rótulo de totalização "Empresa: X" (sem
   `Contrato do Tipo`) apagava o tipo de contrato. Use a tabela de tipos de linha da seção 4.2 das regras, na ordem.
2. Não remover os caracteres de controle `0x02`/`0x03` que sobram depois das sequências `ESC`+2 bytes: deslocam
   posições e quebram o reconhecimento do cabeçalho.
3. Assumir que o rodapé `TOTAIS ->` vem truncado: depois da normalização ele vem completo; mas extraia os números por
   expressão regular, não por posição.
4. Somar a verba uma vez por bloco: nas totalizações o mesmo código repete em várias linhas; some todas.
5. Natureza da conta: calcular a diferença sem converter para a natureza inverte o sinal das contas de ativo.
6. Baixa do saldo anterior por soma acumulada em ordem de data: falha quando um pagamento do próprio mês aparece no
   meio dos pagamentos do mês anterior. Use a combinação exata (seção 7.4 das regras).
7. Usar a `FILIAL DE ORIGEM` do razão como filial: ela difere da `FILIAL CTB` nos lançamentos do Financeiro e nos
   manuais, e não existe no TXT. Use sempre a `FILIAL CTB` (D-8).
8. Tratar a chave `LOTE/SUB/DOC/LINHA` como identificador único: ela repete entre meses. Identidade = (data, chave).
9. Tomar o saldo anterior do relatório como saldo do início da competência: o razão real veio com dois meses. Some as
   linhas anteriores à competência (seção 5.5 das regras).
10. Exigir o mesmo tipo de saldo em todos os razões: no fechamento, o mês está em pré-lançamento (9) e o passado em
   real (1). Combine os dois (seção 5.7 das regras).

## 4. Proibições

- `parseFloat`/`Number()` em texto de valor; `new Date(string)`; carregar o TXT inteiro numa string.
- Inventar o layout do razão em XLSX (P-1) ou a regra de continuação de histórico (P-3), não observados.
- Dependência nova nesta fase. (`pdfjs-dist` está aprovada, mas entra só na Fase 16.)
- Códigos reais de verba, conta, lote, nomes ou valores em `src/`, `tests/` ou `docs/`. Os testes públicos usam o
  gerador sintético (seção 6.1).
- Classificar diferença como material/imaterial, esconder diferença pequena, escrever justificativa final, sugerir
  lançamento de ajuste ou alterar histórico de lançamento. Qualquer diferença ≠ 0 é sinalizada (D-7).
- `if (profile === …)` ou `if (moduleId === …)` em código compartilhado.

---

## 5. Etapas (uma por commit; `npm run test`, `npm run lint` e `npm run build` passando ao fim de cada uma)

Mostre o plano antes de começar. Em cada etapa, escreva primeiro os testes com o resultado esperado.

### Etapa 1 — Esqueleto do módulo e configuração

- `MODULE_IDS` ganha `reconciliation`; descritor em `src/modules/reconciliation/module.ts`: título "Conciliador",
  `shortTitle: 'CONC'`, `preview` com aviso de prévia, aceita qualquer extensão e decide pelo conteúdo (seção 3.2
  das regras; o spool vem como `.__r`/`.##r`),
  `features: { panel, findings, tables, justifications, export: true }`, `helpAnchor: 'reconciliation'`.
- `src/config/defaults/reconciliation.json` e schema zod (seção 6 das regras), `schemaVersion: 1`,
  `profiles.payroll` com `accounts: []`. Validações do schema listadas na seção 6 das regras, cada uma com teste.
- Tela Configuração: aba do Conciliador com **Importar perfil (JSON)** e **Exportar perfil (JSON)**; o JSON importado
  passa pelo mesmo schema. Chave `analyzerConfig:reconciliation`; cópia de segurança `version: 3` já guarda módulos
  por id (sem mudar a versão).
- Sem perfil com contas: o botão Analisar fica desabilitado com a dica "Importe o perfil de contas na Configuração".
- `detect` (seção 3.1 das regras) usando o comando `probe`; para TXT e XML, ler só o início (estender o `probe`
  sem ler o arquivo todo). Identificar relatório (`SIGA /<ROTINA>/`) e formato.

### Etapa 2 — Leitor do GPER040 (S-1)

- `formats/text.ts`: decodificação UTF-8 estrita com troca para windows-1252, normalização da seção 4.1,
  leitura em fluxo, contagem de bytes e linhas, progresso. Serve a todo spool (GPER040, CTBR400 e, na Fase 16,
  GPER070/090).
- `reports/gper040.ts`: recebe **linhas** (não o arquivo) e roda a máquina de estados sobre os tipos de linha (4.2), linha de verbas (4.3), blocos (4.4),
  rodapé (4.5). Saída `PayrollReport` com escopos e, guardados para detalhe, os blocos de funcionário em
  armazenamento compacto (dicionário para códigos; typed arrays para valores).
- Invariantes L-1 a L-7 em `checks`, com mensagem que cita a linha do arquivo. Falha = bloqueia a análise (mesmo
  padrão de bloqueio da plataforma).
- Reconciliação de leitura do arquivo: codificação usada, linhas, linhas `unknown` fora de blocos, blocos por tipo,
  escopos encontrados (nível × filial × contrato), funcionários, período, número de pagamento.

### Etapa 3 — Leitor do razão (S-2): TXT e XML

- `reports/ctbr400.ts` produz os registros normalizados da seção 5.1 a partir de duas entradas:
  - linhas de largura fixa (`formats/text.ts`), com os tipos de linha e campos da seção 5.2 — colunas localizadas
    pela linha de títulos e conferidas com as posições documentadas;
  - linhas de planilha do `formats/spreadsheetml.ts` (seção 5.3): XML em fluxo, `ss:Index`, CDATA, números
    convertidos do **texto** para centavos, aba `Parametros`.
- Fonte de teste local, só no `tests/local`: a cópia do razão no papel de trabalho do usuário (aba "3"), lida pelo
  `readSheet.ts` da plataforma, tolerando a coluna extra "Visão" e as linhas de faixa. Não vira formato da tela.
- Competência e intervalo (5.5): saldo inicial da competência, linhas fora da competência listadas.
- Invariantes R-1 a R-9; classe do lote; verba do histórico; parâmetros na Rastreabilidade.
- Tipos de saldo (5.7): tipo pelo parâmetro 06; visão combinada real + pré-lançamento por conta; achados T1–T3; o
  motor da Etapa 4 recebe só a visão combinada.
- Teste local V-2: o razão real da conta disponível em TXT e em XML produz registros idênticos.

### Etapa 4 — Motor do perfil Folha

- `match/exactKey.ts` e `match/subsetSum.ts` genéricos (sem conhecer folha). `subsetSum`: meet-in-the-middle,
  entrada em ordem estável, desempate da seção 7.4, limite `maxCandidates`, retorno com a situação.
- `profiles/payroll/expected.ts` (F2), `integration.ts` (F1a–F1e), `settlement.ts` (F3), `bridge.ts` (F4, comum),
  `findings.ts` (situação sugerida, 7.6), `narrative.ts` (texto 7.7).
- Invariantes CC-1 a CC-5. CC-3 e CC-4 são testadas em toda conta do gerador sintético.
- Medição: `subsetSum` com 40 candidatos; registrar em `docs/MEDICOES.md`. Acima de ~300 ms, pare e pergunte.

### Etapa 5 — Tela

- Reconciliação de leitura (dois arquivos lado a lado), Painel por conta, Achados, Tabelas (Folha, Integração, Razão,
  Contas), painel lateral da conta com ponte, baixa e texto do critério (copiar), conforme seção 9 das regras.
- Indicadores-chave pelo descritor (`figuresOf`), no máximo 7.
- Justificativas: por conta, texto livre e, se o perfil tiver `workpaperStatuses`, uma lista com essas situações;
  o módulo nunca escolhe a situação do usuário. A situação **sugerida** (7.6) fica ao lado, só leitura.
- Nenhum filtro esconde diferença por valor: R$ 0,01 aparece como qualquer outra (D-7).
- Rótulos novos não podem conter os trechos que os testes e2e buscam (ver `INTERFACE.md`).

### Etapa 6 — Planilha

- Abas e amarrações da seção 10 das regras (sem a aba Provisoes, que entra na Fase 16), com fórmulas (`SUMIFS`, `INDEX` com tratamento de vazio). O Resumo
  mostra "Confere" por conta quando a ponte fecha e quando Integracao bate com Folha_Filial e Razao.
- `xlsxEval` avalia todas as fórmulas usadas (estender se preciso); determinismo byte a byte na parte de dados.
- Conferir o resultado renderizado (Excel → PDF) do Resumo e da Ponte; Aptos/Aptos Display.

### Etapa 7 — Documentação e versão

- `MODULOS.md` (tabela de módulos e contrato: TXT na entrada), `ROTEIRO.md` (Fase 15 com prompt e "Pronto quando"),
  `CLAUDE.md` (parágrafo da plataforma), `public/ajuda.html` (seção `reconciliation`), `CHANGELOG.md` `[2.5.0]`,
  versão 2.5.0. `npm run test:e2e`; medições de memória e tempo com o arquivo real.

---

## 6. Testes

### 6.1 Gerador sintético (`tests/synthetic/payrollFixture.ts`)

Gera, a partir de uma descrição pequena (empresa, filiais, contratos, funcionários, verbas), **o spool TXT e o razão
nos dois formatos (TXT do spool e XML SpreadsheetML) coerentes entre si**. Nenhum dado real; códigos inventados.
Deve produzir, de propósito:
- sequências `ESC`+2 bytes, `FF`, `0x02`/`0x03`, CRLF, e `U+FFFD` em textos de cabeçalho;
- códigos alfanuméricos (ex.: `7AB`), verba repetida em várias linhas de um bloco de totalização, funcionário sem
  verbas (só a base do salário), dois tipos de contrato, duas filiais, os três níveis de totalização;
- no razão: linhas de integração por filial e por centro de custo, pagamentos do Financeiro, lançamento manual com
  `FILIAL DE ORIGEM` ≠ `FILIAL CTB`, saldo anterior e fecho por conta, quebra de página com `A TRANSPORTAR` e
  `DE TRANSPORTE`, dois meses no mesmo relatório, chave repetida entre meses, mais de uma conta no arquivo,
  `ss:Index` e números com casas variáveis no XML; o mesmo razão em tipo 1 e em tipo 9 (marcador `(Pre-Lancamento)`
  no título e parâmetro 06 = 9), com saldo anterior zero no tipo 9 e saldo zero sem D/C;
- variantes com defeito: rodapé que não fecha (L-2), linha `unknown` dentro de bloco (L-1), filial cuja soma não
  bate com a totalização (L-4), código em duas colunas (L-6), razão que não cobre a competência (R-4), razão cujo
  saldo não fecha (R-1), transporte divergente (R-5), dois razões com moeda diferente (R-7), lançamento repetido
  nos dois tipos (R-8), marcador do título contrário ao parâmetro 06 (R-9), saldo anterior ≠ 0 no tipo 9 (T1, não
  bloqueia), conta só com tipo 9 (T3, não bloqueia).

### 6.2 Casos do motor (unidade, sobre o gerador)

| Caso | Esperado |
|---|---|
| Conta `verbas` sem diferença | F2 = 0, nenhum F1, situação "Sem diferença" |
| Verba integrada com valor diferente numa filial | F1a na chave verba × filial |
| Verba do critério sem integração numa filial | F1c; ponte com a parcela "integração − esperado" ≠ 0 |
| Conta `netPay` com uma verba de provento lançada manualmente | 1 F1c; diferença 0 se o manual compensar; ponte com a parcela manual |
| Linha de integração de verba fora do critério | F1b; parcela própria na ponte |
| Saldo anterior pago em 3 lançamentos com 1 pagamento do mês no meio das datas | F3 `IDENTIFICADA` com os 3 corretos; o do mês fica na 5ª parcela |
| Saldo anterior parcialmente pago | F3 `NAO_IDENTIFICADA`; 4ª parcela = saldo anterior inteiro; ponte fecha |
| Duas combinações empatadas | F3 `IDENTIFICADA_AMBIGUA`, escolha pelo desempate |
| 41 candidatos | F3 `NAO_PESQUISADA` |
| Conta de ativo (natureza D) com `settlementVerbas` | baixa encontrada entre linhas de integração dessas verbas |
| Saldo anterior zero | F3 `SEM_SALDO_ANTERIOR` |
| Integração da folha em tipo 9 e saldo anterior em tipo 1 | F1, F3 e ponte iguais aos do caso com tudo em tipo 1; T2 com a parte em tipo 9 |

Para todos: CC-2, CC-3 e CC-4 verdadeiras; mesma saída em duas execuções (CC-5).

### 6.3 Testes locais (`tests/local/reconciliation.test.ts`, fora do CI)

Arquivos em `local/conciliador/` (ignorado pelo git), fornecidos pelo usuário:
- o TXT do GPER040 do mês de referência;
- o razão original da conta `netPay` em TXT e XML (dois meses, tipo 1) e uma amostra em tipo 9 (mês aberto);
- o papel de trabalho com o razão das demais contas na aba "3" (até chegar o razão original delas, P-2);
- `perfil-folha.json` (perfil real, importável pela tela);
- `golden-folha-2026-10.json` (números de referência).

O teste carrega o perfil, roda leitura e motor e compara com o golden: contagens de leitura e totais do escopo;
`linhasConferidasVerbaFilial` e divergentes; as 3 verbas F1c da conta `netPay` (filial, verba, valor); por conta,
esperado, saldo anterior, saldo contábil, diferença (suporte − contábil) e situação de F3; e a equivalência TXT × XML
do razão (`equivalenciaFormatos.CTBR400` do golden de provisões). Pular o teste, sem
falhar, quando a pasta não existir (padrão de `vitest.local.config.ts`).

## 7. Ordem de dependência

Etapa 1 → 2 e 3 (independentes entre si, podem ir em paralelo) → 4 → 5 e 6 (independentes) → 7.

## 8. Pare e pergunte ao usuário se

- o golden local divergir em qualquer número (apresente a conta, o valor esperado, o obtido e as linhas envolvidas);
- uma regra das seções 4, 5 ou 7 de `REGRAS_CONCILIADOR.md` não puder ser aplicada como escrita;
- o arquivo real tiver um tipo de linha, nível de totalização ou coluna não descritos;
- uma dependência nova parecer necessária;
- a medição da baixa (F3) passar de ~300 ms ou a memória passar das metas do `CLAUDE.md`;
- for preciso decidir algo contábil não escrito nas regras (tratamento de verba, sinal de conta).

## 9. Pronto quando

- Com os arquivos de `local/conciliador/`, todos os números do golden batem.
- Para cada conta: valor do Painel = Resumo da planilha = soma da tabela aberta pelo clique; a ponte fecha (CC-3)
  na tela e na planilha recalculada ("Confere" em todas as linhas).
- Invariantes L-*, R-*, V-2 (razão) e CC-* documentadas e testadas; gerador sintético cobre os casos da seção 6.
- e2e, unidade, lint e build passando; nenhum dado real no repositório; memória e tempo medidos e registrados.

---

## Prompt para colar no Claude Code

> Leia `docs/FASE_15_CONCILIADOR_FOLHA.md`, `docs/REGRAS_CONCILIADOR.md`, o `CLAUDE.md`, `docs/MODULOS.md` e
> `docs/INTERFACE.md`. Implemente a Fase 15 na ordem da seção 5, uma etapa por commit, mostrando o plano antes de
> começar e escrevendo os testes primeiro. Respeite as proibições da seção 4 e pare nas situações da seção 8.
