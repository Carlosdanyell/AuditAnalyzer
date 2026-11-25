/**
 * The real GPER040 of the reference month, in local/conciliador/ (docs/FASE_15_CONCILIADOR_FOLHA.md, section 6.3): the
 * reader of section 4 of docs/REGRAS_CONCILIADOR.md against the section "leitura" of the golden (blocks, levels, verba
 * lines, totals of the group / Todos) and the invariants L-1 to L-7 without failure; plus the time and memory of the
 * reading. Prints to the console only counts, the fields that diverge and the measurement, never names or codes. The
 * verba of the net pay comes from the real profile. Skipped when the files are absent.
 */
import { existsSync, openAsBlob, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { readPayrollSpool, type PayrollSource } from '../../src/worker/modules/reconciliation/payrollSource';
import { findScope } from '../../src/worker/modules/reconciliation/reports/gper040';
import { localDir } from './realFiles';

const dir = join(localDir, 'conciliador');
const spoolPath = join(dir, 'gper040-2026-10.txt');
const goldenPath = join(dir, 'golden-folha-2026-10.json');
const profilePath = join(dir, 'perfil-folha.json');
const present = existsSync(spoolPath) && existsSync(goldenPath) && existsSync(profilePath);

setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;
const mb = (n: number) => `${(n / 2 ** 20).toFixed(1)} MB`;

interface GoldenReading {
  blocosFuncionario: number;
  blocosTotalizacao: number;
  niveis: Record<string, number>;
  linhasVerba: number;
  totaisGrupoTodos: Record<string, number>;
}

/** The golden keeps reais as JSON numbers: to cents here, in the test only. */
const cents = (reais: number) => Math.round(reais * 100);

describe.skipIf(!present)('real GPER040 (local/conciliador/gper040-2026-10.txt)', () => {
  it('reads as the golden says, with L-1 to L-7 without failure; measures time and memory', async () => {
    const golden = (JSON.parse(readFileSync(goldenPath, 'utf8')) as { leitura: GoldenReading }).leitura;
    const netPayCode = (JSON.parse(readFileSync(profilePath, 'utf8')) as { payrollReport: { netPayCode: string } }).payrollReport.netPayCode;
    const blob = await openAsBlob(spoolPath);

    gc();
    const base = process.memoryUsage();
    let peak = 0;
    const used = () => {
      const m = process.memoryUsage();
      return m.heapUsed + m.external + m.arrayBuffers - base.heapUsed - base.external - base.arrayBuffers;
    };
    const started = performance.now();
    const source: PayrollSource = await readPayrollSpool(blob, { netPayCode }, () => {
      peak = Math.max(peak, used());
    });
    const ms = performance.now() - started;
    peak = Math.max(peak, used());
    gc();
    const kept = used();
    const { report, reading, checks } = source;
    console.log(
      `[medição] GPER040 real: ${mb(reading.bytes)}, ${reading.lines} linhas em ${ms.toFixed(0)} ms; pico ${mb(peak)} com lixo, mantido ${mb(kept)} (com o relatório lido)`,
    );
    console.log(
      `[leitura] codificação ${reading.encoding}; ${reading.verbaLines} linhas de verba; blocos ${reading.blocks.employee} de funcionário e ${reading.blocks.totalization} de totalização; ` +
        `níveis ${JSON.stringify(reading.levels)}; ${reading.employees} funcionários distintos; ${reading.unknownOutsideBlocks} linhas desconhecidas fora dos blocos; ` +
        `escopos ${reading.scopes.map((s) => `${s.level}${s.branch === null ? '' : '/filial'}/${s.contractType}`).join(', ')}`,
    );
    console.log(`[invariantes] ${checks.map((c) => `${c.id.slice(-2)} ${c.passed ? 'ok' : 'FALHA'}`).join(', ')}`);

    const group = findScope(report, 'groupOfCompanies', 'Todos');
    const columnSum = (column: string) => [...(group?.amounts.values() ?? [])].filter((a) => a.column === column).reduce((s, a) => s + a.amountCents, 0);
    const netKey = Object.keys(golden.totaisGrupoTodos).find((k) => k.startsWith('liquido')) ?? 'liquido';
    const obtained: [string, number, number | undefined][] = [
      ['blocosFuncionario', golden.blocosFuncionario, reading.blocks.employee],
      ['blocosTotalizacao', golden.blocosTotalizacao, reading.blocks.totalization],
      ['niveis.Filial', golden.niveis['Filial']!, reading.levels.branch],
      ['niveis.Empresa', golden.niveis['Empresa']!, reading.levels.company],
      ['niveis.Grupo de Empresas', golden.niveis['Grupo de Empresas']!, reading.levels.groupOfCompanies],
      ['linhasVerba', golden.linhasVerba, reading.verbaLines],
      ['totaisGrupoTodos.proventos (rodapé)', cents(golden.totaisGrupoTodos['proventos']!), group?.footer.earningsCents],
      ['totaisGrupoTodos.proventos (Σ coluna P)', cents(golden.totaisGrupoTodos['proventos']!), columnSum('P')],
      ['totaisGrupoTodos.descontos (rodapé)', cents(golden.totaisGrupoTodos['descontos']!), group?.footer.deductionsCents],
      ['totaisGrupoTodos.descontos (Σ coluna D)', cents(golden.totaisGrupoTodos['descontos']!), columnSum('D')],
      [`totaisGrupoTodos.${netKey} (verba de líquido)`, cents(golden.totaisGrupoTodos[netKey]!), group?.amounts.get(netPayCode)?.amountCents],
      [`totaisGrupoTodos.${netKey} (rodapé)`, cents(golden.totaisGrupoTodos[netKey]!), group?.footer.netCents],
    ];
    const divergent = obtained.filter(([, expected, got]) => expected !== got);
    for (const [field, expected, got] of divergent) console.log(`[divergência] ${field}: esperado ${expected}, obtido ${got}`);
    if (divergent.length === 0) console.log(`[golden] ${obtained.length} campos da leitura iguais ao golden`);
    const failed = checks.filter((c) => !c.passed);
    for (const c of failed) console.log(`[falha] ${c.label}: ${c.message.slice(0, 400)}`);

    expect(divergent.map(([field]) => field)).toEqual([]);
    expect(failed.map((c) => c.id)).toEqual([]);
  });
});
