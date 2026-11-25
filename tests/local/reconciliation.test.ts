/**
 * Golden of the payroll profile (docs/FASE_15_CONCILIADOR_FOLHA.md, section 6.3; never versioned data): the real
 * profile, the real GPER040, the real ledger of the net pay account (TXT, and the same with the XML) and the other
 * accounts from the copy of the ledger in sheet "3" of the workpaper (test source only, tests/local/ledgerWorkpaperSheet.ts),
 * competence of the payroll; the engine (profiles/payroll/analyze.ts) against golden-folha-2026-10.json, sections
 * "integracao" and "contas". Prints to the console only the compared fields and, on a divergence, the account, the
 * field, the expected and obtained values and the ledger lines involved (date, key, FILIAL CTB, verba, class, amount in
 * the natural side; never the history). Skipped when local/conciliador is absent.
 */
import { existsSync, openAsBlob, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPayrollProfileFile, type PayrollProfileConfig } from '../../src/config/reconciliationSchema';
import { formatDay } from '../../src/shared/dates';
import { readSpreadsheetRows } from '../../src/worker/modules/reconciliation/formats/spreadsheetml';
import { readSpoolLines } from '../../src/worker/modules/reconciliation/formats/text';
import type { LedgerFileReading } from '../../src/worker/modules/reconciliation/ledger';
import { readPayrollSpool } from '../../src/worker/modules/reconciliation/payrollSource';
import { analyzePayroll, type PayrollAccountResult, type PayrollAnalysis } from '../../src/worker/modules/reconciliation/profiles/payroll/analyze';
import { LedgerSheetReader, LedgerTextReader, type LedgerReading } from '../../src/worker/modules/reconciliation/reports/ctbr400';
import { readWorkpaperLedger } from './ledgerWorkpaperSheet';
import { localDir } from './realFiles';

const dir = join(localDir, 'conciliador');
const file = (name: string) => join(dir, name);
const NAMES = ['perfil-folha.json', 'gper040-2026-10.txt', 'ctbr400-liquido.__r', 'ctbr400-liquido.xml', 'papel-de-trabalho-folha-2026-10.xlsx', 'golden-folha-2026-10.json'];
const present = NAMES.every((n) => existsSync(file(n)));

/** The golden keeps reais as JSON numbers: to cents here, in the test only. */
const cents = (reais: number) => Math.round(reais * 100);

interface GoldenAccount {
  conta: string;
  natureza: 'D' | 'C';
  esperadoFolha: number;
  saldoAnterior: number;
  movimentoIntegracao: number;
  movimentoFinanceiro: number;
  movimentoManual: number;
  saldoContabil: number;
  diferencaSuporteMenosContabil: number;
  baixaSaldoAnterior: string;
  linhasRazao: number;
}

interface Golden {
  periodo: string;
  integracao: {
    linhasConferidasVerbaFilial: number;
    divergentes: number;
    contaLiquido: { conta: string; verbasConferidas: number; verbasDaFolhaSemIntegracao: { filial: string; verba: string; valor: number }[] };
  };
  contas: GoldenAccount[];
}

async function readText(name: string): Promise<LedgerReading> {
  const reader = new LedgerTextReader();
  await readSpoolLines(await openAsBlob(file(name)), (line, n) => reader.line(line, n));
  return reader.finish();
}

async function readXml(name: string): Promise<LedgerReading> {
  const reader = new LedgerSheetReader();
  await readSpreadsheetRows(await openAsBlob(file(name)), (s, sheetName, r, cells) => reader.row(s, sheetName, r, cells));
  return reader.finish();
}

/** A ledger line for the console: no history (it can hold names). */
function lineText(a: PayrollAccountResult, i: number): string {
  const l = a.lines[i]!;
  return `${formatDay(l.date)} ${l.key} filial ${l.ledgerBranch} verba ${l.verba ?? '—'} ${l.batchClass} ${a.amounts[i]}`;
}

/** Without what only one format has (line of the file, FILIAL DE ORIGEM). */
const essence = (r: PayrollAnalysis) => JSON.parse(JSON.stringify(r, (k, v: unknown) => (k === 'source' || k === 'originBranch' ? undefined : v))) as unknown;

describe.skipIf(!present)('golden of the payroll profile (local/conciliador)', () => {
  it('the engine gives the numbers of the golden: integration and every account', async () => {
    const golden = JSON.parse(readFileSync(file('golden-folha-2026-10.json'), 'utf8')) as Golden;
    const read = readPayrollProfileFile(JSON.parse(readFileSync(file('perfil-folha.json'), 'utf8')));
    if (!read.ok) throw new Error(`perfil inválido: ${read.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
    const profile: PayrollProfileConfig = read.profile;
    const source = await readPayrollSpool(await openAsBlob(file('gper040-2026-10.txt')), { netPayCode: profile.payrollReport.netPayCode });
    expect(source.checks.filter((c) => !c.passed).map((c) => c.id)).toEqual([]);
    expect(source.report.period).toBe(golden.periodo.replace('-', ''));

    const net = profile.accounts.find((a) => a.mode === 'netPay')!.account;
    expect(net).toBe(golden.integracao.contaLiquido.conta);
    const txt = await readText('ctbr400-liquido.__r');
    // The copy in sheet "3" has no Parametros sheet: the currency, balance type and interval of the TXT are given to it.
    const parameters = txt.parameters.filter((p) => ['03', '04', '05', '06'].includes(p.number));
    const others = (await readWorkpaperLedger(file('papel-de-trabalho-folha-2026-10.xlsx'))).filter((r) => !r.accounts.some((a) => a.code === net));
    const sheet: LedgerFileReading[] = others.map((reading, i) => ({ name: `aba 3, bloco ${i + 1}`, reading: { ...reading, parameters } }));
    const run = (ledger: LedgerReading) => analyzePayroll({ payroll: source.report, ledgers: [{ name: 'ctbr400-liquido', reading: ledger }, ...sheet], profile });
    const r = run(txt);
    const fromXml = run(await readXml('ctbr400-liquido.xml'));
    const sameXml = JSON.stringify(essence(fromXml)) === JSON.stringify(essence(r));
    console.log(`[conciliador] competência ${r.period}; razão da conta do líquido em TXT e em XML: ${sameXml ? 'mesmo resultado do motor' : 'RESULTADOS DIFERENTES'}`);
    console.log(`[conciliador] invariantes do motor: ${[...r.checks, ...r.ledger.checks].map((c) => `${c.id} ${c.passed ? 'ok' : 'FALHA'}`).join(', ')}`);

    const divergences: string[] = [];
    const compare = (where: string, field: string, expected: unknown, obtained: unknown, lines: () => string[] = () => []) => {
      const ok = JSON.stringify(expected) === JSON.stringify(obtained);
      console.log(`  ${where} ${field}: golden ${JSON.stringify(expected)}, motor ${JSON.stringify(obtained)}${ok ? '' : '  <-- DIVERGE'}`);
      if (!ok) {
        divergences.push(`${where} ${field}`);
        for (const l of lines().slice(0, 40)) console.log(`      ${l}`);
      }
    };

    // Section "integracao".
    const analyzed = r.accounts.filter((a) => a.status === 'analyzed');
    const netResult = r.accounts.find((a) => a.account === net)!;
    const divergentLines = () => analyzed.flatMap((a) => a.integration!.findings.filter((f) => f.code === 'F1a').flatMap((f) => [`conta ${a.account} ${f.message}`, ...f.lines!.map((i) => `  ${lineText(a, i)}`)]));
    const notCompared = () => analyzed.flatMap((a) => a.integration!.unrecognizedLines.map((i) => `conta ${a.account} (sem verba reconhecível, não comparada com a folha) ${lineText(a, i)}`));
    console.log('[integracao]');
    // D-12: every integration line with a recognized verba is compared (criterion, settlementVerbas and outside the criterion).
    const outside = analyzed.reduce((n, a) => n + a.integration!.outsideLines.length, 0);
    const unrecognized = analyzed.reduce((n, a) => n + a.integration!.unrecognizedLines.length, 0);
    console.log(`  linhas de integração: ${r.integration.criterionLines} do critério, ${outside} de baixa ou fora do critério (comparadas), ${unrecognized} sem verba reconhecível (não comparadas)`);
    compare('integracao', 'linhasConferidasVerbaFilial', golden.integracao.linhasConferidasVerbaFilial, r.integration.checkedLines, notCompared);
    compare('integracao', 'divergentes', golden.integracao.divergentes, r.integration.divergent, divergentLines);
    compare('integracao', 'contaLiquido.verbasConferidas', golden.integracao.contaLiquido.verbasConferidas, netResult.integration!.keys.filter((k) => k.status === 'equal' || k.status === 'different').length);
    const f1c = netResult
      .integration!.keys.filter((k) => k.status === 'missing')
      .map((k) => ({ filial: k.branch, verba: k.verba, valor: k.column === 'D' ? -k.payroll : k.payroll }));
    const byKey = (x: { filial: string; verba: string }, y: { filial: string; verba: string }) => (x.filial + x.verba < y.filial + y.verba ? -1 : 1);
    compare(
      'integracao',
      'contaLiquido.verbasDaFolhaSemIntegracao (F1c)',
      [...golden.integracao.contaLiquido.verbasDaFolhaSemIntegracao].map((v) => ({ ...v, valor: cents(v.valor) })).sort(byKey),
      f1c.sort(byKey),
    );

    // Section "contas".
    console.log('[contas]');
    for (const g of golden.contas) {
      const a = r.accounts.find((x) => x.account === g.conta);
      if (!a || a.status !== 'analyzed') {
        compare(g.conta, 'situação', 'analisada', a ? `${a.status}: ${a.reason}` : 'fora do perfil');
        continue;
      }
      const all = () => a.lines.map((_, i) => lineText(a, i));
      const ofClass = (c: string) => () => a.lines.flatMap((l, i) => (l.batchClass === c ? [lineText(a, i)] : []));
      compare(g.conta, 'natureza', g.natureza, a.naturalSide);
      compare(g.conta, 'esperadoFolha', cents(g.esperadoFolha), a.expected!.amount);
      compare(g.conta, 'saldoAnterior', cents(g.saldoAnterior), a.competenceOpening);
      compare(g.conta, 'movimentoIntegracao', cents(g.movimentoIntegracao), a.movements.integration, ofClass('integration'));
      compare(g.conta, 'movimentoFinanceiro', cents(g.movimentoFinanceiro), a.movements.financial, ofClass('financial'));
      compare(g.conta, 'movimentoManual', cents(g.movimentoManual), a.movements.manual, ofClass('manual'));
      compare(g.conta, 'saldoContabil', cents(g.saldoContabil), a.ledgerBalance, all);
      compare(g.conta, 'diferencaSuporteMenosContabil', cents(g.diferencaSuporteMenosContabil), a.difference, all);
      compare(g.conta, 'baixaSaldoAnterior', g.baixaSaldoAnterior, a.settlement!.situation, () => a.settlement!.candidates.map((i) => `candidato ${lineText(a, i)}${a.settlement!.settled.includes(i) ? ' (na baixa)' : ''}`));
      compare(g.conta, 'linhasRazao', g.linhasRazao, a.lines.length, all);
    }
    console.log(divergences.length === 0 ? '[conciliador] todos os números do golden batem' : `[conciliador] ${divergences.length} campo(s) divergem do golden: ${divergences.join('; ')}`);

    expect(sameXml).toBe(true);
    expect(r.checks.filter((c) => !c.passed).map((c) => c.id)).toEqual([]);
    expect(divergences).toEqual([]);
  });
});
