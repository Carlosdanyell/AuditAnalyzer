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

### Pendente

- **Computador do trabalho (Chrome/Edge corporativo):** tempo de leitura e pico de memória do worker pelo
  Gerenciador de tarefas do navegador (Shift+Esc → linha "Dedicated worker" ou a aba). O navegador não expõe a
  memória do worker para a página, então essa medição é manual.
- **Computador do trabalho:** repetir tempos e memória (Gerenciador de tarefas do navegador, Shift+Esc).
