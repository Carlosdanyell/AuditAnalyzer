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
- No caso de dois arquivos, quase todas as exceções são E5: o período padrão é o mês da menor data (agosto), e as
  linhas de setembro ficam fora dele (seção 6.5; o período passa a ser informado na tela na Fase 12).

