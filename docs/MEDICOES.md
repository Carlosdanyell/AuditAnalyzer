# Medições de desempenho

Metas (ARQUITETURA.md, 1.4): ingestão de ~1 milhão de linhas < 60 s; pico do worker < 400 MB com dois arquivos;
thread principal < 150 MB e sem travar.

Somente tempos e memória. **Não registrar aqui o tamanho, o número de linhas nem a velocidade em linhas/s dos
arquivos reais** (junto com o tempo, a velocidade revela o número de linhas); esses números aparecem apenas na
saída local de `npm run test:local`. Registrar cada nova medição com data, máquina e fase.

## 2026-09-25 — Fase 1 (leitura), máquina de desenvolvimento

Máquina: Intel Pentium Gold 7505 (2,0 GHz, 2 núcleos), 11,7 GB de RAM, Windows 11.
Arquivo: uma extração real, dentro da faixa típica descrita em ARQUITETURA.md.

| Ambiente | Tempo total | Leitura das linhas | Memória |
|---|---|---|---|
| Node 24 (`npm run test:local`) | 4,9 s | 4,5 s | RSS do processo 190 MB; heap 40 MB |
| Navegador (Chromium embutido, `npm run dev`), 1ª execução | ~11 s | — | thread principal: heap 23 MB |
| Navegador, 2ª execução | 6,8 s | — | — |

Responsividade da interface (navegador): durante o processamento, o maior intervalo entre duas tarefas da
thread principal foi de 6 ms (medido por cadeia de `MessageChannel`, que não sofre com janela em segundo plano).

## 2026-09-25 — Fase 2 (motor), mesma máquina e arquivo

| Ambiente | Tempo total | Observação |
|---|---|---|
| Node 24 (`npm run test:local`) | 5,5 s | leitura 5,2 s + eventos, registros, documentos e invariantes |
| Navegador (`npm run dev`) | 6,5 s | maior bloqueio da thread principal: 32 ms (renderização final das tabelas) |

No Node, tudo o que vem depois da leitura (eventos, registros, documentos e invariantes, incluindo a partição
diária do invariante 6) somou cerca de 0,3 s neste arquivo.

## 2026-09-25 — Fase 3 (painel e tabelas), mesma máquina e arquivo, navegador (`npm run dev`)

| Operação | Tempo |
|---|---|
| Painel completo (categorias, comparação, composição, sinalizações, movimento diário) | 33 ms |
| Primeira página de cada tabela (6 tabelas) | 0–33 ms |
| Ordenar a base de linhas por valor (asc / desc) | 54 / 44 ms |
| Busca sem resultado na base de linhas | ~120 ms (além dos 250 ms de espera da digitação) |
| Salto de rolagem de milhares de linhas: linhas na tela / dados preenchidos | 37–89 ms / 63–153 ms |

Maior bloqueio da thread principal durante a navegação: 44 ms.

## 2026-09-25 — Dois arquivos (agosto + setembro), mesma máquina

| Ambiente | Tempo total | Memória / responsividade |
|---|---|---|
| Node 24, agosto sozinho (`npm run test:local`) | 8,4 s | RSS do processo 226 MB; heap 88 MB |
| Node 24, os dois arquivos | 15,1 s | RSS do processo 423 MB (inclui Node, Vitest e as duas análises por arquivo + a consolidada); heap 168 MB |
| Navegador (`npm run dev`), os dois arquivos | 17,5 s | thread principal: heap 18 MB; maior bloqueio 17 ms na leitura e 45 ms na navegação |

Painel com os dois arquivos: 123 ms; primeira página da base de linhas: 33 ms.

### Memória do worker no Chrome (2026-09-26, mesma máquina, os dois arquivos)

Medida com `performance.measureUserAgentSpecificMemory()` numa página com isolamento de origem (servidor de
desenvolvimento com os cabeçalhos COOP/COEP), que separa a memória por contexto:

| Momento | Worker | Tela (thread principal) |
|---|---|---|
| Durante a leitura das linhas | 61 MB | — |
| Logo após o processamento | 75 MB | — |
| Depois de navegar pelas telas (caches de tabelas e painel) | 98 MB | 19 MB |

A API só responde após uma coleta de lixo, então as amostras não pegam necessariamente o pico exato; ainda assim, a
folga para a meta de 400 MB é grande. O RSS do processo Node (tabela acima) não é comparável, porque inclui o Node e o
Vitest.

## 2026-09-26 — Fase 5 (exportação), mesma máquina, os dois arquivos, escopo consolidado

| Ambiente | Tempo | Responsividade / observações |
|---|---|---|
| Navegador (`npm run dev`), planilha em inglês | 3,4 s a 4,1 s | maior intervalo sem resposta da thread principal durante a exportação: 5 ms |
| Node 24 (`npm run test:local`), português e inglês | 3,4 s a 5,6 s | — |
| Excel 16 (automação, teste local): abrir, recalcular 4 períodos e ler o Resumo | ~25 s por idioma | nenhuma célula com erro de fórmula; sem reparo ao abrir |

Depois do novo padrão visual (grade em todas as células, colunas de identificação e compressão nível 3): Node,
3,7 s a 4,0 s por idioma. No painel do navegador oculto a mesma exportação levou 22,5 s (a página oculta tem o
processamento limitado pelo navegador); repetir com a página visível no computador do trabalho.

O gerador grava cada aba em pedaços de 64 KB comprimidos na hora; a memória adicional do worker durante a exportação
fica limitada ao arquivo comprimido e aos pedaços em trânsito. A medição direta da memória do worker (API
`measureUserAgentSpecificMemory`) não foi possível desta vez: o painel do navegador estava oculto e a API exige a
página visível.

### Computador do trabalho (26/09/2026)

Verificado pelo usuário no Chrome/Edge corporativo: tempo de leitura, memória do worker (inclusive durante a
exportação) e a planilha exportada aberta no Excel — todos dentro das metas. Os valores não foram registrados aqui.

## 2026-09-29 — Análise segregada por tipo de saldo (seção 13), ambiente de nuvem (Linux, Node 22)

Arquivo **sintético** de 987 mil linhas de detalhe (147 mil eventos: inclusão em 9, efetivação 9 → 1 e alteração de
histórico em 10% dos registros), o maior disponível neste ambiente (os arquivos reais ficam em `local/`, fora do
repositório). Mesma máquina e mesmo arquivo, duas execuções cada, `runIngestion` no Node (Vitest, `--expose-gc`):

| Versão | Ingestão completa | Heap após a análise |
|---|---|---|
| `main` (antes) | 8,8 s / 9,2 s | 274 MB |
| com a seção 13 | 9,2 s / 9,6 s | 275 MB |

Custo da análise segregada: ~0,4 s (≈ 4–5%) e ~1 MB de heap para 147 mil eventos, coerente com a estimativa de
~14 bytes por evento na linha do tempo + 12 bytes por evento por escopo (typed arrays, nenhum objeto por evento). O
heap inclui o arquivo sintético e as linhas mantidos pelo teste, por isso não é comparável com a memória do worker no
navegador. Repetir com os arquivos reais (`npm run test:local`) no computador do trabalho.

## 2026-10-21 — Fase 9 (Integridade da CT2: leitura), ambiente de nuvem (Linux, 4 núcleos, Node 22)

Extrações **sintéticas** da CT2 (`tests/synthetic/ct2Large.ts`: 80 colunas, ~60 células por linha, strings
compartilhadas, metade dos históricos distintos e uma sequência distinta por linha), geradas uma vez na pasta
temporária do sistema. `MEDIR_CT2=1 npm run test:local` (`tests/local/ct2Measure.test.ts`), um caso por processo.
Memória = heap + ArrayBuffers acima do que estava em uso antes: **pico vivo** amostrado depois de uma coleta de lixo
a cada ~1 s (comparável à medição do navegador com `measureUserAgentSpecificMemory`) e o que a base mantém no fim.

Primeira medição (1 arquivo, ~1 milhão de linhas): 47,5 s; mantido 290 MB; pico vivo 420 MB. Três causas corrigidas
(`docs/ARQUITETURA.md`, seção 1.3): tabela de strings para colunas de textos quase todos distintos (~145 bytes por
valor), strings compartilhadas presas aos pedaços decodificados e ~8 buscas por célula no parser da aba.

| Caso | Tempo | Leitura das linhas | Pico vivo | Mantido (base) |
|---|---|---|---|---|
| 1 arquivo, ~1 milhão de linhas (263 MB) | 44,9 s | 41,7 s | 219 MB | 152 MB (113 MB) |
| 2 arquivos, ~1,3 milhão de linhas | 55,9 s | 27,9 s + 23,9 s | 220 MB | 194 MB (144 MB) |

- Descompressão: `fflate`. O `DecompressionStream` do Node lê adiante toda a parte comprimida da aba (sem
  contrapressão; 255 MB a mais no início da leitura do arquivo de 1 milhão de linhas, liberados aos poucos); no
  navegador o fluxo tem contrapressão. Com o nativo, o tempo é o mesmo (45,2 s e 54,9 s).
- Ordenação da base e invariantes: < 1 s para 1,3 milhão de linhas.
- O tempo depende do número de células por linha: o parser custa ~0,3 µs por célula, o mesmo do CFGR700.
- O CFGR700 usa o mesmo parser da aba (atalho da célula usual): saídas idênticas (testes congelados); o tempo do
  CFGR700 não foi medido de novo nesta rodada.
- Pendente: medir no Chromium com a tela da prévia (memória do worker) e repetir no computador do trabalho com as
  extrações reais (`tests/local/ct2Golden.test.ts` mostra o tempo e a memória na saída local).

### Fase 10: leitura + análise (aglutinação, testes, invariantes)

Mesmas extrações sintéticas e mesmo método, agora com a análise na mesma ingestão (configuração padrão, sem feriados).

| Caso | Tempo | Aglutinação e testes | Pico vivo | Mantido (base) | Exceções |
|---|---|---|---|---|---|
| 1 arquivo, ~1 milhão de linhas | 47,5 s | 2,0 s | 223 MB | 182 MB (113 MB) | 110.162 |
| 2 arquivos, ~1,3 milhão de linhas | 58,8 s | 2,8 s | 283 MB | 236 MB (144 MB) | 744.132 |

- A análise acrescenta ~3 s e ~60 MB ao pico vivo (chaves de ordenação ainda vivas, débito e crédito por posição da
  base, marcas e as tabelas de dispersão do CI-6); continua abaixo da meta de 400 MB do worker.
- No caso de dois arquivos, quase todas as exceções eram E5: o período padrão era o mês da menor data (agosto), e as
  linhas de setembro ficavam fora dele. Pela decisão de 29/10/2026, o período padrão cobre todos os meses lidos; as
  medições acima foram feitas antes dessa mudança, que não altera tempo nem memória.

## Integridade da CT2 — planilha amarrada (Fase 11)

Extrações sintéticas (`tests/synthetic/ct2Large.ts`, ~80 colunas), planilha gerada pela ferramenta e aberta no
LibreOffice 24.2 sem interface, que recalcula todas as fórmulas (a planilha não traz valores em cache) e exporta o
Resumo em CSV; depois do recálculo, a matriz de amarração e o quadro de testes têm de estar todos OK/Confere.
`MEDIR_CT2_PLANILHA=1 MEDIR_CT2_LINHAS=40000,300000 npm run test:local` (`tests/local/ct2WorkpaperMeasure.test.ts`;
`MEDIR_CT2_SO_MAPEADAS=1` mede a Base só com as colunas mapeadas). Máquina: 4 núcleos, 15 GB.

| Linhas | Base | Geração | Arquivo | Maior aba (sem compressão) | Recálculo no LibreOffice | Matriz e quadro |
|---|---|---|---|---|---|---|
| 40 mil | todas as colunas | 6,4 s | 29 MB | 261 MB | 14 s | todos OK |
| 300 mil | todas as colunas | 46,9 s | 218 MB | 2,0 GB | 140 s | todos OK |
| 300 mil | só mapeadas | 31,2 s | 139 MB | 1,1 GB | 111 s | todos OK |
| 1 milhão | todas as colunas | 158 s | 727 MB | 6,7 GB (passa de 4 GB) | 423 s | 7 "Verificar": arquivo corrompido |
| 1 milhão | só mapeadas | — | 465 MB | 3,7 GB | encerrado por falta de memória | — |

- Com ~80 colunas, a aba Base de 1 milhão de linhas passa de 4 GB sem compressão, o limite de uma parte do ZIP sem
  ZIP64, que o `fflate` não grava: o tamanho registrado "dá a volta" e o arquivo sai corrompido. Desde então o
  `XlsxWriter` para com erro claro antes de passar do limite.
- A saída comprimida é guardada em Blobs de 16 MB durante a geração: o pico de memória da geração caiu de 219 MB
  (300 mil linhas, saída inteira no heap do worker) para 41 MB.
- 1 milhão de linhas não é viável no formato atual. Decisão de 29/10/2026 (seção 7.9 das regras): até 300.000 linhas
  por exportação, com todas as colunas; acima disso, a exportação é bloqueada e a extração deve ser dividida.
- Pendente: medir no Excel do computador do trabalho (`EXCEL_CHECK=1`) e com a extração real.

### 2026-10-30 — um ano numa exportação (Base em abas de dias inteiros)

A extração real de janeiro a setembro tem 339.167 linhas (cerca de 37,7 mil por mês; um ano, cerca de 450 mil) e
passava do teto de 300.000. Mesmo método e máquina; `MEDIR_CT2_LINHAS=450000,600000`.

| Linhas | Base | Geração | Arquivo | Maior aba (sem compressão) | Pico da geração | Recálculo no LibreOffice | Matriz e quadro |
|---|---|---|---|---|---|---|---|
| 450 mil | uma aba (antes da divisão) | — | 327 MB | 3,2 GB | — | 241 s | todos OK |
| 600 mil | uma aba (antes da divisão) | — | 436 MB | 4,2 GB (no limite de 4 GiB) | — | 360 s | todos OK |
| 450 mil | 2 abas de dias inteiros | 71,9 s | 328 MB | 1,9 GB | 55 MB | 188 s | todos OK |
| 600 mil | 2 abas de dias inteiros | 100,1 s | 437 MB | 2,0 GB | 39 MB | 266 s | todos OK |

- Com 600 mil linhas numa aba só, a Base fica a 2% do limite de uma parte do ZIP sem ZIP64. Dividida a cada 300 mil
  linhas, na virada de um dia, cada aba fica do tamanho já medido com 300 mil linhas, longe do limite.
- A divisão não muda o tamanho do arquivo e deixou o recálculo mais rápido (188 s contra 241 s com 450 mil linhas).
- Decisão de 30/10/2026 (seção 7.9 das regras): até 600.000 linhas por exportação, com todas as colunas e todas as
  fórmulas.

