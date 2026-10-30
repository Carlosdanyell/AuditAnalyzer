# Plataforma de análises — contrato dos módulos

A partir da versão 2, o AuditAnalyzer é uma **plataforma de análises**: um único aplicativo estático, com as mesmas
restrições do `CLAUDE.md` (nada sai da máquina, memória controlada, determinismo, integridade verificável), que
hospeda **módulos de análise** independentes. Cada módulo recebe o seu tipo de extração (os de hoje, do Protheus),
aplica regras próprias e gera o seu papel de trabalho em Excel. A plataforma é feita para receber outras ferramentas
contábeis (por exemplo, conciliações) pelo mesmo contrato, sem mudar a casca nem a marca.

| Módulo | Entrada | Regras | Situação |
|---|---|---|---|
| `cfgr700` — Log de auditoria | Relatório CFGR700 (tabela CT2) | `docs/REGRAS_CFGR700.md` | em uso desde a 1.0.0 |
| `ct2Integrity` — Integridade da CT2 | Extração da tabela CT2 (lançamentos) | `docs/REGRAS_CT2_INTEGRIDADE.md` | em uso desde a 2.1.0 (prévia na 2.0.0; conferida com extração real em 30/10/2026) |

**Decisão (20/10/2026):** revoga a decisão de 26/09/2026 registrada na Fase 6 do roteiro ("a generalização saiu do
escopo; outra área = ferramenta própria"). Novas análises entram como módulos desta plataforma, não como ferramentas
separadas, para reaproveitar leitura, worker, exportação, identidade visual e rastreabilidade. A generalização é
**por módulo**, não por configuração: um módulo novo tem motor e regras próprias; não se tenta fazer o motor do
CFGR700 ler outras tabelas.

---

## 1. Princípios

1. **O módulo CFGR700 não muda de comportamento.** A Fase 8 só o registra como módulo. `generalMode.test.ts`,
   os testes de exportação e os testes de ponta a ponta continuam passando sem alteração de expectativa.
2. **Compartilhado é infraestrutura; regra de negócio é do módulo.** Nada de `if (module === ...)` no código
   compartilhado.
3. **Um worker por sessão, um módulo por sessão.** Trocar de módulo encerra a sessão, como "Encerrar sessão": descarta
   a análise e limpa a lista de arquivos (os arquivos de uma análise não servem à outra). "Nova análise" mantém o
   módulo e os arquivos.
4. **Configuração por módulo**, validada por zod, com `schemaVersion` próprio, hash e diferenças em relação ao padrão
   na Rastreabilidade. Feriados são configuração **da plataforma** (usados por mais de um módulo).

## 2. O que é compartilhado

| Camada | Itens | Onde fica |
|---|---|---|
| Leitura | ZIP com acesso aleatório, inflate, CRC32, SHA-256, sharedStrings, leitura da aba em fluxo, dicionário, colunas | `src/worker/ingest/`, `src/worker/store/` |
| Exportação | gerador XLSX em fluxo, tema, mesclagens validadas, nomes definidos, formatação condicional, aba Rastreabilidade | `src/worker/export/` |
| Utilitários | datas sem fuso, centavos, formatação pt-BR, hash da configuração | `src/shared/` |
| Tela | Arquivos, Processamento (etapas), Reconciliação de leitura, tabelas virtualizadas, Exportação, Configuração, tema, ajuda, cópia de segurança | `src/app/`, `src/components/` |

## 3. Contrato de um módulo

Cada módulo declara, em `src/modules/<id>/module.ts` (lado da tela) e `src/worker/modules/<id>/index.ts` (lado do
worker):

```ts
interface ModuleDescriptor {            // tela e worker
  id: 'cfgr700' | 'ct2Integrity';
  title: string;                        // "Log de auditoria (CFGR700)", "Integridade da CT2"
  description: string;                  // uma frase no seletor de análises
  accepts: { extensions: ['.xlsx']; maxFiles: number };
  detect(headerSample: string[][]): 'match' | 'maybe' | 'no';   // aviso de arquivo trocado, nunca bloqueia sozinho
  configSchema: ZodType;                // schema próprio
  defaultConfig: unknown;               // config/defaults/<id>.json
  helpAnchor: string;                   // seção do manual (ajuda.html#<id>)
}

interface WorkerModule {                // só no worker; funções puras + estado da sessão
  ingest(files: { name; blob; sheet?: string }[], config, progress): Promise<Reconciliation>;   // sheet: escolhida na tela
  analyze(config, progress): Promise<{ summary: Summary; checks: CheckResult[] }>;
  panel(query): PanelData;              // agregados pequenos
  page(query): { rows; total };         // páginas de até 2.000 linhas
  export(options, progress): Promise<Blob>;
  tables: TableDefinition[];            // colunas e tipos exibidos na tela
}
```

- O protocolo (`src/shared/protocol.ts`) ganha `module: ModuleId` no comando `ingest`; as demais mensagens seguem o
  módulo da sessão. Tipos de painel e de tabela de cada módulo ficam em `src/shared/modules/<id>.ts`.
- Configuração no IndexedDB: chave `analyzerConfig:<id>` (a chave atual `analyzerConfig` é migrada para
  `analyzerConfig:cfgr700` na primeira abertura, sem perda). A cópia de segurança passa a guardar todas as
  configurações e as justificativas, com `schemaVersion` da cópia incrementado e leitura das cópias antigas.
- Invariantes: cada módulo numera os seus com prefixo (`CI-1`, `CI-2`… no `ct2Integrity`); os do CFGR700 mantêm a
  numeração atual.

### 3.1 Contrato implementado (Fases 8 e 9)

O código é a referência (`src/modules/types.ts` e `src/worker/modules/types.ts`):

```ts
// Tela — descritor sem React (o worker também pode importar)
type ModuleDescriptor = AvailableModule | ComingSoonModule;
interface AvailableModule<C> {
  status: 'available'; id: ModuleId; title; shortTitle; description; input; brandSubtitle;
  preview: string | null;                               // Fase 9: selo "Prévia" e aviso enquanto o módulo é parcial
  start: { heading; headingDescription; uploadTitle; uploadDescription; dropTitle; guide };   // tela inicial
  progress: { stages: { id: Stage; label }[]; perFile: number };   // etapas do processamento
  accepts: { extensions: readonly string[]; maxFiles: number };
  helpAnchor: string;                                   // public/ajuda.html#<anchor>
  features: { panel; tables; justifications; export: boolean };   // visões além da reconciliação
  config: { defaults(): C; read(input: unknown): ModuleConfigRead<C>; saved: boolean };
  detect(sheets: SheetSample[], config: C): 'match' | 'maybe' | 'no';   // Fase 9; nunca bloqueia
}
interface ComingSoonModule { status: 'comingSoon'; id; title; description; input; helpAnchor: null }

// Worker
interface WorkerModule {
  configure(config: unknown): Ingest;                   // valida (lança se inválida) e devolve a ingestão
}
type Ingest = (inputs, post, options) => Promise<{ reconciliation; summary; checks; session: ModuleSession }>;
interface ModuleSession {                               // objeto novo a cada ingestão; nada fica guardado no módulo
  panel(scope, period, cutoffDay): PanelData;
  page(scope, table, filter, sort, offset, limit): { columns; rows; total };   // limit ≤ 2.000 (handler)
  export(options, onProgress): Promise<{ blob; fileName } | { blocked: CheckResult[] }>;
  settings?: { update(settings): PanelSettings };       // atalhos e feriados durante a sessão
  justifications?: { set(items, replace); preview(file) };
}
```

**Decisões de 20/10/2026 em relação ao contrato acima (aprovadas pelo usuário):**
- `module` é **opcional** no `ingest` (ausente = `cfgr700`): os testes que enviam `ingest` sem módulo continuam
  compilando no `npm run build`; a tela sempre envia o campo.
- Leitura e análise numa chamada só (`Ingest`), como o `runIngestion` já faz; um `analyze()` vazio seria código morto.
  A separação entra na Fase 12, com os parâmetros de execução da CT2.
- `page` devolve também as colunas; `export` devolve o nome do arquivo ou o bloqueio por verificação.
- A lista de tabelas continua do lado da tela (`TablesView`); a definição por módulo entra nas Fases 9 e 12.
- `detect()` e o aviso "Este arquivo parece ser…" ficam para a **Fase 9**: o cabeçalho só é lido no worker, então
  precisa de um comando de sondagem; com um único módulo disponível, o aviso não teria para onde mandar. Quando vier,
  `detect` recebe também a configuração salva (os títulos do CFGR700 são configuráveis) e nunca bloqueia.
  **Implementado na Fase 9:** comando `probe` (primeiras 30 linhas de cada aba, lendo só o começo das abas e da
  sharedStrings; nunca responde erro); `detect(sheets, config)` em cada descritor, com a configuração com que a
  análise rodaria (salva, `config.saved`, ou o padrão do módulo); `suggestModule` (`src/modules/registry.ts`) escolhe
  o primeiro outro módulo que reconhece um arquivo que o escolhido não reconhece (`no`). O aviso mantém a lista de
  arquivos ao trocar e nunca impede de analisar.
- **Fase 9:** a tela envia a cada módulo a própria configuração: a salva no computador quando `config.saved` (hoje só
  o CFGR700) ou o padrão do módulo; só a salva pode pedir reprocessamento. As visões que o módulo não oferece
  (`features`) aparecem bloqueadas no menu, e o botão "Exportar planilha" some. Etapas do processamento, passos de
  "Como funciona" e tela de reconciliação são do módulo (`StageProgress` recebe `progress`; a CT2 tem
  `Ct2ReconciliationView`, que reaproveita as partes comuns da do CFGR700).
- Os tipos de painel e de tabela do CFGR700 continuam em `src/shared/protocol.ts`; mudam para
  `src/shared/modules/cfgr700.ts` na Fase 9, com reexportação.
- Configuração: a chave `analyzerConfig` é **copiada** para `analyzerConfig:cfgr700` e mantida como espelho, gravada
  junto em todo salvamento (uma aba com a versão anterior continua com as regras atuais). Detalhes em
  `docs/ARQUITETURA.md`, seção 6.
- Feriados da plataforma: chave `platformConfig`, copiados sem reordenar para `calendar.holidays` da configuração do
  CFGR700, que continua no mesmo esquema (versão 2): o SHA-256 e as diferenças da Rastreabilidade não mudam.
- Cópia de segurança: o campo continua `version` (uma versão anterior leria `schemaVersion` como "Versão undefined"),
  `2` com `platform` (feriados) e, a partir da Fase 10, `3` com `modules` (configuração de cada outro módulo, por id,
  validada e migrada pelas regras do módulo; um id desconhecido é ignorado). As versões 1 e 2 continuam sendo lidas,
  sem os outros módulos (a configuração deles fica como está).
- **Fase 10:** a configuração de cada módulo além do CFGR700 fica na chave própria `analyzerConfig:<id>` (sem chave
  antiga para migrar; `planModuleConfigLoad` em `src/shared/configStorage.ts`): ausente = padrão, sem gravar; versão
  anterior = migrada e regravada; ilegível = padrão com aviso, sem sobrescrever. O comando `ingest` leva `platform`
  (feriados) e `WorkerModule.configure(config, platform)` recebe os dois; o CFGR700 continua com os feriados dentro da
  própria configuração. A tela Configuração tem uma aba por análise com regras salvas e a cópia de segurança abaixo
  (`BackupCard`); a tela de cada módulo além do CFGR700 é achada pelo descritor (`src/app/moduleViews.tsx`), nunca
  pelo id. Mudar a configuração ou os feriados depois da análise oferece reprocessar.
- Imports estáticos nos dois registros: a CSP não muda e nada é buscado depois do carregamento.
- **Fase 12:** comandos `analyze` (reaplica a análise com os parâmetros informados, validados pelo módulo; responde
  `analyzed` com o resumo e as verificações novas) e `segmentPanel` (painel recortado por segmento); `page` aceita as
  tabelas e filtros de cada módulo (`AnyTableId`, `AnyTableFilter`). Na tela, cada módulo tem a sua área de trabalho
  depois da análise (`src/app/modules/<id>/`, contrato em `src/app/modules/workspace.ts`), achada pelo descritor em
  `workspaceOf` (`src/app/moduleViews.tsx`); o `App.tsx` ficou com a casca (arquivos, processamento, barra lateral,
  configuração). As visões oferecidas seguem `features` do descritor.
- **Fase 11:** a parte comum das planilhas fica em `src/worker/export/common/` (aba Rastreabilidade, SHA-256 e diferenças
  da configuração, verificações bloqueantes com confirmação, CI-7 de datas); a mesclagem sobreposta continua barrada
  pelo próprio `XlsxWriter`. A visão Exportação mostra o conteúdo de cada módulo (`ExportContent`).

## 4. Tela

- **Início da plataforma (Ferramentas):** uma linha por módulo numa lista com colunas (`src/components/ToolHome.tsx`:
  código curto, título, descrição, arquivo esperado, situação "Prévia"/"Em breve", link para a ajuda); a linha abre o
  espaço de trabalho do módulo. A última usada (chave `lastModule` do store `config`, gravada ao clicar em Analisar) e
  a análise aberta são marcadas na linha. Voltar às Ferramentas mantém a análise; abrir outro módulo a encerra.
- No espaço de trabalho o fluxo é o mesmo para todos: Arquivos → Processamento → Reconciliação → (visões que o módulo
  oferece). A trilha no topo mostra "Ferramentas › módulo | arquivos"; o trilho à esquerda mostra só as visões
  oferecidas. Com a análise pronta, a faixa de indicadores-chave vem da função do módulo achada pelo descritor em
  `figuresOf` (`src/app/moduleViews.tsx`; contrato `KeyFigures` em `src/app/modules/workspace.ts`).
- **Uma ferramenta nova na tela** precisa de: código curto (`shortTitle`, 2 a 8 maiúsculas, algarismos ou hífen, para
  caber no trilho de 100 px; testado em `moduleRegistry.test.ts`), título, descrição e arquivo esperado para a linha
  do início, a seção do manual (`helpAnchor`), as visões que oferece (`features`) e, com a análise pronta, até seis
  indicadores-chave (`KeyFigures`). Cores, fontes, logo e componentes são os da plataforma: a ferramenta não traz
  marca própria.
- Se `detect` disser `no` para o arquivo solto e outro módulo disser `match`, a tela avisa ("Este arquivo parece ser
  … Trocar de análise?", botão "Mudar para …", que mantém a lista) e deixa seguir. (Fase 9; ver 3.1.)
- O que já está em `docs/INTERFACE.md` continua obrigatório para o módulo CFGR700; os comportamentos do novo módulo
  estão na seção 9 de `docs/REGRAS_CT2_INTEGRIDADE.md`.

## 5. Estrutura de pastas (alvo)

```
src/
  shared/modules/index.ts    # MODULE_IDS, ModuleId, DEFAULT_MODULE_ID (Fase 8)
  config/platform.ts         # feriados da plataforma (Fase 8)
  modules/
    registry.ts              # lista de ModuleDescriptor
    cfgr700/module.ts
    ct2Integrity/module.ts   # + views próprias do painel
  worker/
    modules/
      cfgr700/index.ts       # adaptador fino sobre o motor atual (engine/, export/paperwork.ts ficam onde estão)
      ct2Integrity/
        ingest.ts  normalize.ts  aggregate.ts  tests.ts  checks.ts  panel.ts  tables.ts
        export/workbook.ts
  config/defaults/
    ct2.json                 # CFGR700 (não muda)
    ct2-integrity.json       # novo módulo
```

Mover o motor do CFGR700 para `worker/modules/cfgr700/` não é objetivo da Fase 8; pode ser feito depois, isolado, com
os testes como rede de segurança.
