# Fase 16 — Conciliador: provisões (Padrão B) e leitura de PDF

Descrição de execução para o Claude Code. Pré-requisito: **Fase 15 concluída** (módulo `reconciliation`, Padrão A,
razão em TXT e XML, golden local da folha batendo). Leia antes, nesta ordem: `CLAUDE.md`, `docs/MODULOS.md`,
**`docs/REGRAS_CONCILIADOR.md`** (seções 3.3, 3.4, 6 e 8 são o objeto desta fase), `docs/ARQUITETURA.md` e
`docs/INTERFACE.md`. Todas as restrições do `CLAUDE.md` continuam valendo; em especial: **repositório público sem
dados reais**, centavos inteiros, determinismo, nada sai da máquina.

---

## 1. Objetivo

1. Ler o GPER070 (férias) e o GPER090 (13º), analíticos ou sintéticos, e conciliar as contas de provisão com o razão
   por conta, por filial e por linha da ponte (Padrão B, `mode: 'provision'`).
2. Adaptador de PDF para todos os relatórios do perfil (GPER040, GPER070, GPER090, CTBR400), entregando aos leitores
   as mesmas linhas do TXT.

Fora desta fase: razão em XLSX (P-1), balancete, outros perfis.

## 2. O que já está validado (não reabrir sem motivo)

Reproduzido em protótipo sobre o mesmo mês real da Fase 15:
- GPER070 e GPER090 em TXT: todos os colaboradores e totais lidos; invariantes P-1 a P-8 sem falha.
- As seis contas de provisão: saldo anterior, provisão do mês, baixas e saldo atual do total do grupo iguais ao razão;
  **por filial**, as três linhas da ponte iguais ao razão; nenhum B1b, B1c ou B1d; diferença zero.
- PDF: a reconstrução da grade (seção 3.3 das regras) deu, para GPER070 e GPER090, linhas **idênticas** às do TXT;
  para o GPER040, idênticas exceto acentos; para o CTBR400, os mesmos lançamentos, valores, filiais e saldos do XML e
  do TXT. Nenhum caractere fora da grade.

Os números ficam no golden local (seção 6.3).

## 3. Erros já cometidos no protótipo (evite)

1. Matrícula com 4 ou 5 dígitos seguida de vários espaços (`MAT: 2694   NOME:`): uma regex com um espaço só não
   reconhece o cabeçalho e as linhas do colaborador caem no bloco anterior (vira linha repetida). Use `\s+`.
2. Exigir as três seções (VENCIDAS, A VENCER, TOTAL) em todo colaborador de férias: muitos têm só uma. Use o total
   efetivo da seção 8.1 das regras.
3. Ler valores das provisões por posição: no TXT real há linhas com as colunas deslocadas ±2. Use os 8 números do fim
   da linha.
4. Tomar `Rescis` sozinho no início da linha como lixo: é a continuação do rótulo "Valor Baixa".
5. Confiar na largura do glifo informada pela biblioteca de PDF para calcular a coluna: o avanço entre caracteres é
   outro. Use o passo medido entre itens (seção 3.3 das regras).
6. Esperar no PDF as linhas de separação e o cabeçalho de página do TXT: são desenho e fonte proporcional. Os leitores
   não podem depender delas.
7. Comparar o **saldo** por filial nas provisões: as transferências entre filiais mexem no saldo da filial e não têm
   lançamento. Compare **movimentos** por filial e o saldo só no total do grupo.

## 4. Proibições

- Dependência nova além de `pdfjs-dist` (aprovada, D-6). Nenhum recurso do pdf.js buscado na rede.
- OCR, ou "corrigir" um PDF cuja leitura não fecha.
- Inventar o sinal da 1ª parcela do 13º além do que está em P-1 (P-4 pendente).
- Dados reais em `src/`, `tests/` ou `docs/`; os testes públicos usam o gerador sintético.
- Classificar diferença, esconder diferença pequena, escrever justificativa final ou sugerir lançamento.

---

## 5. Etapas (uma por commit; `npm run test`, `npm run lint` e `npm run build` passando ao fim de cada uma)

Mostre o plano antes de começar. Em cada etapa, escreva primeiro os testes com o resultado esperado.

### Etapa 1 — Configuração do Padrão B

- Schema: `mode: 'provision'` e `provisionReports` (seção 6 das regras), com as validações listadas; migração não é
  necessária (o `schemaVersion` continua 1 se a Fase 15 ainda não foi publicada; se foi, `schemaVersion` 2 com
  migração que só acrescenta `provisionReports` vazio).
- Importação do perfil local com as contas de provisão; conta sem relatório na sessão = "não analisada".

### Etapa 2 — Leitor das provisões (S-3/S-4)

- `reports/provision.ts`: tipos de linha, rótulos, seções, total efetivo, quebra de página dentro do bloco (8.1).
  Duas configurações (`vacation`, `thirteenth`) com as colunas do perfil, conferidas com o cabeçalho.
- Invariantes P-1 a P-8 (8.2), com mensagem que cita a linha. Falha bloqueia.
- Reconciliação de leitura: relatório, data-base, colaboradores, marcadores (`CONGELADO`, `TRANSFERENCIA`),
  demitidos no mês, filiais, e o informativo de contagem entre GPER040, GPER070 e GPER090.
- Sintético (só totais) e analítico com o mesmo leitor; no analítico, P-4 vale; no sintético, P-4 não se aplica.

### Etapa 3 — Motor do Padrão B

- `profiles/payroll/provision.ts`: B1a–B1d por filial e linha da ponte (8.3), B2, B3; ponte 8.4 em `bridge.ts`
  (comum); situação sugerida (7.6); texto do critério 8.5.
- CC-2, CC-3 e CC-4 testadas em toda conta `provision` do gerador sintético.

### Etapa 4 — Adaptador de PDF

- `formats/pdf.ts` com `pdfjs-dist` (configuração e algoritmo da seção 3.3 das regras), página a página, liberando
  cada página; progresso por página; cancelável.
- Saída: as linhas da grade monoespaçada + o texto proporcional por página. Os leitores `gper040`, `provision` e
  `ctbr400` recebem essas linhas sem saber a origem; o `ctbr400` lê os parâmetros do texto proporcional.
- V-1 (fora da grade) e V-3 (mesmo relatório em dois formatos na sessão).
- CSP de `index.html`: só o necessário para o worker do pdf.js servido pelo app; e2e "nenhuma requisição externa".
- Medir memória e tempo com o maior PDF real (folha, centenas de páginas) e registrar em `docs/MEDICOES.md`; acima das
  metas do `CLAUDE.md`, pare e pergunte.

### Etapa 5 — Tela e planilha

- Tela: Painel com o padrão (A/B) por conta; tabela Provisões (filial × linha × coluna); painel lateral com o quadro
  por filial; formato detectado e invariantes V na Reconciliação de leitura.
- Planilha: aba Provisoes e as linhas do Padrão B no Resumo, na Integracao e na Ponte, por fórmula (seção 10 das
  regras); Rastreabilidade com o formato de cada arquivo e a versão do pdf.js.

### Etapa 6 — Documentação e versão

- `REGRAS_CONCILIADOR.md` (o que mudar ao implementar), `MODULOS.md`, `ROTEIRO.md` (Fase 16 com prompt e "Pronto
  quando"), `public/ajuda.html`, `CHANGELOG.md` `[2.7.0]`, versão 2.7.0 (a 2.6.0 publicou o editor de perfil, a etapa 1 e a leitura de PDF da etapa 4), licença do pdf.js em `public/licencas`.

---

## 6. Testes

### 6.1 Gerador sintético

Estender o gerador da Fase 15 (`tests/synthetic/payrollFixture.ts`) para produzir, coerentes entre si e com o razão:
- GPER070 e GPER090 em TXT, analítico e sintético: colaborador com as três seções, só A VENCER, só VENCIDAS, sem
  valores (`CONGELADO`), transferido entre filiais (par entrada/saída), demitido no mês (baixa por rescisão),
  negativo em `No Mes`, matrícula de 4 e 5 dígitos, bloco quebrado por página, `Rescis` em linha própria, colunas
  deslocadas ±2 numa linha;
- razão das contas de provisão: integração por filial e centro de custo, estorno com o marcador, um débito sem o
  marcador (variante B1c);
- a integração das provisões em pré-lançamento (tipo 9) com o saldo anterior em real (tipo 1): o resultado tem de ser
  igual ao do mesmo caso todo em tipo 1;
- **PDF sintético** dos mesmos relatórios para o teste do adaptador. Gerar o PDF no próprio teste com fonte
  monoespaçada e cabeçalho em fonte proporcional, sem dependência nova de produção (dependência de
  desenvolvimento só se indispensável, e então pare e pergunte);
- variantes com defeito: P-1, P-2, P-3, P-4, P-5, P-7 e P-8 quebrados; PDF com um caractere fora da grade (V-1).

### 6.2 Casos do motor (unidade)

| Caso | Esperado |
|---|---|
| Conta de provisão sem diferença | B1/B2/B3 sem achado; situação "Sem diferença" |
| Integração de uma filial com valor diferente na provisão do mês | B1a na filial e linha; ponte com a parcela |
| Verba de outra conta lançada na conta de provisão | B1b |
| Débito de verba de provisão sem o marcador | B1c |
| Saldo inicial do razão diferente de `ANTER` | B2; ponte com a parcela |
| Transferência entre filiais | nenhum achado; saldo por filial não comparado |
| 13º (sem baixa por férias) | `vacationRelease` ausente aceito; linha da ponte zerada |

Para todos: CC-2, CC-3, CC-4 e CC-5.

### 6.3 Testes locais (`tests/local/`, fora do CI)

Arquivos em `local/conciliador/` (ignorado pelo git), fornecidos pelo usuário: GPER070 e GPER090 em TXT e PDF, GPER040
em PDF (o TXT já está lá), razão da conta `netPay` em PDF (TXT e XML já estão lá), o papel de trabalho das provisões
com o razão das contas de provisão na aba "3", `perfil-folha.json` (com as contas de provisão) e
`golden-provisoes-2026-10.json`.

O teste compara com o golden: contagens e marcadores de leitura; por conta, total do grupo (anterior, provisão do mês,
baixas, transferências, atual) e as três linhas da ponte **por filial**; achados esperados (nenhum); e a equivalência
de formatos: GPER070 PDF = TXT, GPER090 PDF = TXT, GPER040 PDF = TXT (exceto acentos), CTBR400 PDF = XML = TXT. Os
números da folha da Fase 15 continuam batendo com os arquivos em PDF no lugar dos TXT.

## 7. Ordem de dependência

Etapa 1 → 2 → 3; Etapa 4 independe de 1–3 (pode ir em paralelo depois da 1) → 5 → 6.

## 8. Pare e pergunte ao usuário se

- o golden local divergir em qualquer número (conta, filial, linha da ponte, valor esperado, obtido, linhas);
- uma regra das seções 3.3, 3.4, 6 ou 8 de `REGRAS_CONCILIADOR.md` não puder ser aplicada como escrita;
- aparecer rótulo, seção, coluna ou marcador não descritos (ex.: colaborador com duas seções e sem TOTAL);
- P-1 falhar só pela 1ª parcela do 13º (P-4);
- um PDF real tiver caractere fora da grade ou corpo sem fonte monoespaçada;
- memória ou tempo da leitura de PDF passarem das metas.

## 9. Pronto quando

- Com os arquivos de `local/conciliador/`, todos os números do golden de provisões batem, e o golden da folha continua
  batendo com os relatórios em PDF.
- Para cada conta de provisão: Painel = Resumo = tabela aberta pelo clique; a ponte fecha (CC-3) na tela e na planilha
  recalculada.
- Invariantes P-*, B-*, V-* documentadas e testadas; gerador sintético cobre os casos da seção 6.
- e2e (inclui "nenhuma requisição externa" com PDF), unidade, lint e build passando; nenhum dado real no repositório;
  memória e tempo medidos e registrados.

---

## Prompt para colar no Claude Code

> Leia `docs/FASE_16_CONCILIADOR_PROVISOES_PDF.md`, `docs/REGRAS_CONCILIADOR.md`, o `CLAUDE.md`, `docs/MODULOS.md` e
> `docs/INTERFACE.md`. Confirme que a Fase 15 está concluída. Implemente a Fase 16 na ordem da seção 5, uma etapa por
> commit, mostrando o plano antes de começar e escrevendo os testes primeiro. Respeite as proibições da seção 4 e pare
> nas situações da seção 8.
