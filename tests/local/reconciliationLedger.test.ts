/**
 * The real CTBR400 ledgers in local/conciliador/ (docs/FASE_15_CONCILIADOR_FOLHA.md, section 6.3; never versioned):
 * - V-2: the same ledger in TXT and in XML reads to identical records (the first divergence is printed by place only);
 * - the type-9 sample against `amostraTipo9` of the golden;
 * - the copy of the ledger in sheet "3" of the workpaper (test source only): every account of the real profile present
 *   there is read; lines and the competence balances are printed.
 * Prints to the console only; reading time and memory of the TXT and the XML are measured. Skipped without the files.
 */
import { existsSync, openAsBlob, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatDay } from '../../src/shared/dates';
import { readSpoolLines } from '../../src/worker/modules/reconciliation/formats/text';
import { readSpreadsheetRows } from '../../src/worker/modules/reconciliation/formats/spreadsheetml';
import { readingDivergence } from '../../src/worker/modules/reconciliation/ledger';
import {
  LedgerSheetReader,
  LedgerTextReader,
  balanceText,
  competenceDays,
  ledgerBalanceType,
  ledgerInterval,
  ledgerReadingChecks,
  type LedgerReading,
} from '../../src/worker/modules/reconciliation/reports/ctbr400';
import { readWorkpaperLedger } from './ledgerWorkpaperSheet';
import { localDir } from './realFiles';

const dir = join(localDir, 'conciliador');
const file = (name: string) => join(dir, name);
const has = (...names: string[]) => names.every((n) => existsSync(file(n)));

/** Golden values in reais (JSON numbers) → cents; only for the comparison of the test. */
const cents = (reais: number) => Math.round(reais * 100);

interface Measured<T> {
  value: T;
  ms: number;
  heapMb: number;
}

async function measured<T>(run: () => Promise<T>): Promise<Measured<T>> {
  globalThis.gc?.();
  const heap = process.memoryUsage().heapUsed;
  const start = performance.now();
  const value = await run();
  return { value, ms: performance.now() - start, heapMb: (process.memoryUsage().heapUsed - heap) / 1048576 };
}

async function readText(name: string): Promise<Measured<LedgerReading & { encoding: string; lines: number; bytes: number }>> {
  return measured(async () => {
    const reader = new LedgerTextReader();
    const spool = await readSpoolLines(await openAsBlob(file(name)), (line, n) => reader.line(line, n));
    return { ...reader.finish(), encoding: spool.encoding, lines: spool.lines, bytes: spool.bytes };
  });
}

async function readXml(name: string): Promise<Measured<LedgerReading & { bytes: number }>> {
  return measured(async () => {
    const reader = new LedgerSheetReader();
    const sheet = await readSpreadsheetRows(await openAsBlob(file(name)), (s, sheetName, r, cells) => reader.row(s, sheetName, r, cells));
    return { ...reader.finish(), bytes: sheet.bytes };
  });
}

const failedChecks = (reading: LedgerReading, year: number, month: number) =>
  ledgerReadingChecks(reading, competenceDays(year, month))
    .filter((c) => !c.passed)
    .map((c) => c.id);

const summary = (r: LedgerReading) =>
  `${r.accounts.length} conta(s), ${r.accounts.reduce((n, a) => n + a.lines.length, 0)} lançamentos, ${r.transports.length} transportes, ` +
  `${r.unknown.length} linha(s) desconhecida(s), ${r.invalid.length} ilegível(is), tipo de saldo ${ledgerBalanceType(r) ?? '?'}`;

/** The shape of a real line without its content: runs of spaces, digits, letters and the other characters. */
function masked(text: string): string {
  const cls = (c: string) => (c === ' ' ? '␠' : /\d/.test(c) ? '9' : /\p{L}/u.test(c) ? 'a' : c);
  const runs: string[] = [];
  let last = '';
  let n = 0;
  for (const c of [...text].map(cls)) {
    if (c === last) n++;
    else {
      if (n > 0) runs.push(`${last}×${n}`);
      last = c;
      n = 1;
    }
  }
  if (n > 0) runs.push(`${last}×${n}`);
  return runs.join(' ');
}

/** Lines that block (unknown inside an account: R-6; unreadable: R-3): place and reason, the text masked. */
const issues = (r: LedgerReading) => [...r.unknown.filter((i) => i.account !== null), ...r.invalid].map((i) => `linha ${i.source}${i.account ? ' (dentro de conta)' : ''}: ${i.reason} [${masked(i.text)}]`);
/** Unknown lines outside the accounts (informative, they do not block): printed for the user to confirm. */
const outside = (label: string, r: LedgerReading) => {
  for (const i of r.unknown.filter((u) => u.account === null)) console.log(`  ${label}: linha ${i.source} fora de conta, tipo não descrito: [${masked(i.text)}]`);
};

describe.skipIf(!has('ctbr400-liquido.__r', 'ctbr400-liquido.xml'))('V-2: the real ledger in TXT and in XML', () => {
  it('produces identical records (lines, order, values, branches, counterparts, balances)', async () => {
    const txt = await readText('ctbr400-liquido.__r');
    const xml = await readXml('ctbr400-liquido.xml');
    console.log(`[ctbr400 TXT] ${txt.value.bytes} bytes, ${txt.value.lines} linhas, ${txt.value.encoding}: ${summary(txt.value)}; ${txt.ms.toFixed(0)} ms, Δheap ${txt.heapMb.toFixed(1)} MB`);
    console.log(`[ctbr400 XML] ${xml.value.bytes} bytes, ${xml.value.sourceLines} linhas de planilha: ${summary(xml.value)}; ${xml.ms.toFixed(0)} ms, Δheap ${xml.heapMb.toFixed(1)} MB`);
    outside('TXT', txt.value);
    outside('XML', xml.value);
    for (const line of [...issues(txt.value), ...issues(xml.value)]) console.log(`  ${line}`);
    expect(issues(txt.value)).toEqual([]);
    expect(issues(xml.value)).toEqual([]);
    const d = readingDivergence(txt.value, xml.value);
    console.log(d ? `[V-2] primeira divergência: ${d.what} (TXT linha ${d.sourceA ?? '—'}, XML linha ${d.sourceB ?? '—'})` : '[V-2] registros idênticos');
    expect(d?.what ?? null).toBeNull();
    const interval = ledgerInterval(txt.value)!;
    console.log(`[ctbr400] intervalo ${formatDay(interval.from)} a ${formatDay(interval.to)}; falhas na competência 10/2026: TXT ${failedChecks(txt.value, 2026, 10).join(', ') || 'nenhuma'}, XML ${failedChecks(xml.value, 2026, 10).join(', ') || 'nenhuma'}`);
    expect(failedChecks(txt.value, 2026, 10)).toEqual([]);
    expect(failedChecks(xml.value, 2026, 10)).toEqual([]);
  });
});

describe.skipIf(!has('ctbr400_saldo_9.__r', 'golden-folha-2026-10.json'))('the real type-9 sample', () => {
  it('matches amostraTipo9 of the golden', async () => {
    const golden = (JSON.parse(readFileSync(file('golden-folha-2026-10.json'), 'utf8')) as { amostraTipo9: Record<string, unknown> }).amostraTipo9;
    const { value: r } = await readText('ctbr400_saldo_9.__r');
    const interval = ledgerInterval(r)!;
    const account = r.accounts.find((a) => a.code === golden['conta'])!;
    const lines = account?.lines ?? [];
    const got = {
      parametro06: ledgerBalanceType(r),
      intervalo: `${formatDay(interval.from)} a ${formatDay(interval.to)}`,
      marcadorTitulo: r.titles!.withMarker > 0 && r.titles!.withoutMarker === 0 ? golden['marcadorTitulo'] : '(sem marcador)',
      saldoAnterior: account?.openingBalance,
      linhas: lines.length,
      debitos: lines.reduce((s, l) => s + l.debit, 0),
      creditos: lines.reduce((s, l) => s + l.credit, 0),
      saldoFinal: account?.closing ? balanceText(account.closing.balance) : null,
    };
    const expected = {
      parametro06: golden['parametro06'],
      intervalo: golden['intervalo'],
      marcadorTitulo: golden['marcadorTitulo'],
      saldoAnterior: cents(golden['saldoAnterior'] as number),
      linhas: golden['linhas'],
      debitos: cents(golden['debitos'] as number),
      creditos: cents(golden['creditos'] as number),
      saldoFinal: golden['saldoFinal'],
    };
    const wrong = Object.keys(expected).filter((k) => got[k as keyof typeof got] !== expected[k as keyof typeof expected]);
    console.log(`[tipo 9] ${summary(r)}; ${wrong.length === 0 ? 'igual ao golden' : `diverge do golden em: ${wrong.join(', ')}`}`);
    outside('tipo 9', r);
    for (const line of issues(r)) console.log(`  ${line}`);
    expect(issues(r)).toEqual([]);
    expect(wrong).toEqual([]);
    const failures = failedChecks(r, 2026, 11);
    console.log(`[tipo 9] invariantes na competência 11/2026: falham ${failures.join(', ') || 'nenhuma'} (golden: ${golden['invariantes']})`);
    expect(failures).toEqual(['R-4']);
  });
});

describe.skipIf(!has('papel-de-trabalho-folha-2026-10.xlsx', 'perfil-folha.json'))('the ledger copy in sheet "3" of the workpaper (test source)', () => {
  it('reads every account of the real profile present there', async () => {
    const profile = JSON.parse(readFileSync(file('perfil-folha.json'), 'utf8')) as { accounts: { account: string; naturalSide: 'D' | 'C' }[] };
    const golden = has('golden-folha-2026-10.json')
      ? (JSON.parse(readFileSync(file('golden-folha-2026-10.json'), 'utf8')) as { periodo: string; contas: { conta: string; saldoAnterior: number; saldoContabil: number; linhasRazao: number }[] })
      : null;
    const readings = await readWorkpaperLedger(file('papel-de-trabalho-folha-2026-10.xlsx'));
    const [year, month] = (golden?.periodo ?? '2026-10').split('-').map(Number) as [number, number];
    const competence = competenceDays(year, month);
    const found = new Map(readings.flatMap((r) => r.accounts.map((a) => [a.code, { r, a }] as const)));
    const missing = profile.accounts.filter((p) => !found.has(p.account)).length;
    console.log(`[aba 3] ${readings.length} conta(s) lida(s); ${profile.accounts.length - missing} de ${profile.accounts.length} contas do perfil presentes`);
    const problems: string[] = [];
    for (const p of profile.accounts) {
      const hit = found.get(p.account);
      if (!hit) continue;
      const { r, a } = hit;
      const before = a.lines.filter((l) => l.date < competence.first);
      const within = a.lines.filter((l) => l.date >= competence.first && l.date <= competence.last);
      const after = a.lines.length - before.length - within.length;
      const start = a.openingBalance + before.reduce((s, l) => s + l.credit - l.debit, 0);
      const end = start + within.reduce((s, l) => s + l.credit - l.debit, 0);
      // Without the Parametros sheet, R-4 and R-9 cannot hold; the others must.
      const failed = ledgerReadingChecks(r, competence).filter((c) => !c.passed && c.id !== 'R-4' && c.id !== 'R-9').map((c) => c.id);
      const g = golden?.contas.find((c) => c.conta === p.account);
      const nature = p.naturalSide === 'C' ? 1 : -1;
      const vsGolden = g ? (cents(g.saldoAnterior) === nature * start && cents(g.saldoContabil) === nature * end && g.linhasRazao === within.length ? 'igual ao golden' : 'DIVERGE do golden') : 'sem golden';
      console.log(
        `  ${p.account}: ${a.lines.length} linhas (${within.length} na competência, ${before.length} antes, ${after} depois); ` +
          `saldo inicial da competência ${balanceText(start)}, final ${balanceText(end)}; invariantes ${failed.join(', ') || 'ok'}; ${vsGolden}` +
          `${issues(r).length > 0 ? `; ${issues(r).join('; ')}` : ''}`,
      );
      outside(p.account, r);
      if (failed.length > 0 || issues(r).length > 0) problems.push(p.account);
    }
    expect(problems).toEqual([]);
    expect(found.size).toBeGreaterThan(0);
  });
});
