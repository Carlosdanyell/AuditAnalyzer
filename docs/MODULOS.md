# Plataforma de análises — contrato dos módulos

A partir da versão 2, o AuditAnalyzer é uma **plataforma de análises**: um único aplicativo estático, com as mesmas
restrições do `CLAUDE.md` (nada sai da máquina, memória controlada, determinismo, integridade verificável), que
hospeda **módulos de análise** independentes. Cada módulo recebe um tipo de extração do Protheus, aplica regras
próprias e gera o seu papel de trabalho em Excel.

| Módulo | Entrada | Regras | Situação |
|---|---|---|---|
| `cfgr700` — Log de auditoria | Relatório CFGR700 (tabela CT2) | `docs/REGRAS_CFGR700.md` | versão 1.0.0, em uso |
| `ct2Integrity` — Integridade da CT2 | Extração da tabela CT2 (lançamentos) | `docs/REGRAS_CT2_INTEGRIDADE.md` | especificado (Fases 8–13) |

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
  ingest(files: File[], config, progress): Promise<Reconciliation>;
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

### 3.1 Contrato implementado na Fase 8

O código é a referência (`src/modules/types.ts` e `src/worker/modules/types.ts`):

```ts
// Tela — descritor sem React (o worker também pode importar)
type ModuleDescriptor = AvailableModule | ComingSoonModule;
interface AvailableModule<C> {
  status: 'available'; id: ModuleId; title; shortTitle; description; input; brandSubtitle;
  start: { heading; headingDescription; uploadTitle; uploadDescription; dropTitle };   // textos da tela inicial
  accepts: { extensions: readonly string[]; maxFiles: number };
  helpAnchor: string;                                   // public/ajuda.html#<anchor>
  features: { justifications: boolean };
  config: { defaults(): C; read(input: unknown): ModuleConfigRead<C> };
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
- Os tipos de painel e de tabela do CFGR700 continuam em `src/shared/protocol.ts`; mudam para
  `src/shared/modules/cfgr700.ts` na Fase 9, com reexportação.
- Configuração: a chave `analyzerConfig` é **copiada** para `analyzerConfig:cfgr700` e mantida como espelho, gravada
  junto em todo salvamento (uma aba com a versão anterior continua com as regras atuais). Detalhes em
  `docs/ARQUITETURA.md`, seção 6.
- Feriados da plataforma: chave `platformConfig`, copiados sem reordenar para `calendar.holidays` da configuração do
  CFGR700, que continua no mesmo esquema (versão 2): o SHA-256 e as diferenças da Rastreabilidade não mudam.
- Cópia de segurança: o campo continua `version` (uma versão anterior leria `schemaVersion` como "Versão undefined"),
  agora `2`, com `platform` (feriados); a versão 1 continua sendo lida. As configurações de outros módulos entram na
  cópia quando existirem (Fase 10), com nova versão.
- Imports estáticos nos dois registros: a CSP não muda e nada é buscado depois do carregamento.

## 4. Tela

- **Início:** seletor de análises (um cartão por módulo: título, descrição, tipo de arquivo esperado, link para a
  ajuda). A última análise usada fica pré-selecionada (preferência no store `config`, chave `lastModule`, gravada ao
  clicar em Analisar; valor desconhecido ou "Em breve" volta ao padrão). Implementado na mesma tela da área de
  arquivos, com o CFGR700 marcado desde a primeira renderização (`src/components/ModuleSelector.tsx`).
- Depois da escolha, o fluxo é o mesmo para todos: Arquivos → Processamento → Reconciliação → Painel → Tabelas →
  Exportação. O nome do módulo aparece no topo; "Trocar análise" volta ao início e encerra a sessão.
- Se `detect` disser `no` para o arquivo solto, a tela avisa ("Este arquivo parece ser … — trocar de análise?") e
  deixa seguir. (Fase 9; ver 3.1.)
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
