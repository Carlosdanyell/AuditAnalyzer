import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createCommandHandler } from '../../src/worker/handler';
import type { LedgerFileCard, PayrollFileCard, ReconciliationReconciliation, ReconciliationSummary } from '../../src/shared/modules/reconciliation';
import type { Command, WorkerEvent } from '../../src/shared/protocol';
import { payrollSpool } from '../synthetic/payrollFixture';
import { ledgerSpool } from '../synthetic/ledgerFixture';
import { ASSET_ACCOUNT, NET_ACCOUNT, VERBAS_ACCOUNT, engineFixture } from '../synthetic/payrollLedgerFixture';
import { provisionProfileFile } from '../synthetic/reconciliationProfile';
import { configOf, screenFixture, sessionFiles, type SessionFile } from '../synthetic/reconciliationSession';

/**
 * Ingestion of the Conciliador through the worker handler (Phase 15, step 5): classification by content, SHA-256 and
 * size of every file, progress per file, the board of invariants, the payroll engine and the session queries, over the
 * synthetic payroll and ledger (tests/synthetic/reconciliationSession.ts). Invented data only.
 */
const toFile = (f: SessionFile) => new File([f.bytes as Uint8Array<ArrayBuffer>], f.name);

async function ingest(files: SessionFile[], config: unknown) {
  const events: WorkerEvent[] = [];
  const handle = createCommandHandler((e) => events.push(e), { progressIntervalMs: 0 });
  await handle({ type: 'ingest', module: 'reconciliation', files: files.map(toFile), config });
  const recon = events.find((e) => e.type === 'reconciliation');
  const ready = events.find((e) => e.type === 'ready');
  const error = events.find((e) => e.type === 'error');
  let id = 0;
  const query = async <T extends WorkerEvent['type']>(command: { type: Command['type'] } & Record<string, unknown>, type: T) => {
    const requestId = ++id + 1000;
    const before = events.length;
    await handle({ ...command, requestId } as unknown as Command);
    const answer = events.slice(before).find((e) => 'requestId' in e && e.requestId === requestId);
    if (answer?.type !== type) throw new Error(`resposta ${answer?.type}: ${answer && 'message' in answer ? answer.message : ''}`);
    return answer as Extract<WorkerEvent, { type: T }>;
  };
  return {
    events,
    error: error?.type === 'error' ? error : null,
    reconciliation: recon?.type === 'reconciliation' ? (recon.data as ReconciliationReconciliation) : null,
    summary: ready?.type === 'ready' ? (ready.summary as ReconciliationSummary) : null,
    query,
  };
}

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const codes = (r: ReconciliationReconciliation) => r.checks.map((c) => c.id);
const failing = (r: ReconciliationReconciliation) => r.checks.filter((c) => !c.passed).map((c) => c.id);
const stranger: SessionFile = { name: 'anotacoes.txt', bytes: new TextEncoder().encode('lista de tarefas do mês\r\nnada a ver com o Protheus\r\n') };

describe('ingestion of the Conciliador (worker)', () => {
  it('classifies each file by its content, hashes it, reads it and runs the analysis', async () => {
    const { fx, real, preEntry } = screenFixture();
    const files = [...sessionFiles(fx, [{ format: 'text', fixture: real }, { format: 'xml', fixture: preEntry }]), stranger];
    const r = await ingest(files, configOf(fx.profile));
    expect(r.error).toBeNull();
    const recon = r.reconciliation!;
    expect(recon.module).toBe('reconciliation');
    expect(recon.files.map((f) => f.kind)).toEqual(['payroll', 'ledger', 'ledger', 'other']);
    recon.files.forEach((f, i) => {
      expect(f.name).toBe(files[i]!.name);
      expect(f.size).toBe(files[i]!.bytes.length);
      expect(f.sha256).toBe(sha(files[i]!.bytes));
    });
    const payroll = recon.files[0] as PayrollFileCard;
    expect(payroll).toMatchObject({ report: 'GPER040', format: 'text', used: true, period: '202610' });
    expect(payroll.checks.map((c) => c.id)).toEqual(['L-1', 'L-2', 'L-3', 'L-4', 'L-5', 'L-6', 'L-7']);
    const [ledgerReal, ledgerPre] = [recon.files[1] as LedgerFileCard, recon.files[2] as LedgerFileCard];
    expect([ledgerReal.format, ledgerReal.balanceType, ledgerPre.format, ledgerPre.balanceType]).toEqual(['text', '1', 'xml', '9']);
    expect(ledgerReal.accounts.map((a) => a.code)).toEqual([NET_ACCOUNT, VERBAS_ACCOUNT, ASSET_ACCOUNT]);
    expect(ledgerReal.interval).not.toBeNull();
    expect(ledgerReal.checks.map((c) => c.id)).toEqual(['R-1', 'R-2', 'R-3', 'R-4', 'R-5', 'R-6', 'R-9']);
    // The unrecognized file is a warning: listed, out of the analysis, never blocking.
    expect(recon.files[3]).toMatchObject({ kind: 'other', report: null });
    expect(recon.alerts.some((a) => a.level === 'warning' && a.message.startsWith('anotacoes.txt:'))).toBe(true);
    // The board: one entry per code, every family.
    expect(codes(recon)).toEqual(['L-1', 'L-2', 'L-3', 'L-4', 'L-5', 'L-6', 'L-7', 'R-1', 'R-2', 'R-3', 'R-4', 'R-5', 'R-6', 'R-9', 'R-7', 'R-8', 'V-3', 'T1', 'T3', 'F2', 'CC-1', 'CC-2', 'CC-3', 'CC-4']);
    expect(failing(recon)).toEqual([]);
    expect(recon.checks.every((c) => c.label.startsWith(`${c.id} · `))).toBe(true);
    expect(recon.competence).toMatchObject({ period: '202610' });
    expect(recon.ledgerAccounts.map((a) => [a.account, a.types, a.missing, a.inProfile])).toEqual([
      [NET_ACCOUNT, ['1', '9'], null, true],
      [VERBAS_ACCOUNT, ['1', '9'], null, true],
      [ASSET_ACCOUNT, ['1', '9'], null, true],
    ]);

    // Progress: the two stages of each file, with its index, then the stages of the session.
    const progress = r.events.filter((e): e is Extract<WorkerEvent, { type: 'progress' }> => e.type === 'progress');
    for (const i of [0, 1, 2, 3]) {
      expect(progress.some((p) => p.stage === 'fileCheck' && p.fileIndex === i)).toBe(true);
      expect(progress.some((p) => p.stage === 'rows' && p.fileIndex === i)).toBe(true);
    }
    expect(progress.some((p) => p.stage === 'checks')).toBe(true);

    const s = r.summary!;
    expect(s).toMatchObject({ module: 'reconciliation', period: '202610', scopeLabel: 'Grupo de Empresas / Todos', blocking: 0 });
    expect(s.accounts.map((a) => [a.tickMark, a.status, a.situation])).toEqual([
      ['#01', 'analyzed', 'noDifferenceCheckAlerts'],
      ['#02', 'analyzed', 'differenceExplained'],
      ['#03', 'analyzed', 'noDifference'],
    ]);
    const net = s.accounts[0]!;
    expect(net.difference).toBe(0);
    expect(net.balance).toBe((net.balanceReal ?? 0) + (net.balancePreEntry ?? 0));
    expect(s.accounts[1]!.settlement).toMatchObject({ situation: 'IDENTIFICADA', lines: 3, amount: 100000 });
    expect(s.figures).toMatchObject({ accounts: 3, analyzed: 3, noDifference: 2, withDifference: 1, integrationErrors: 0, missingIntegration: 1 });
    expect(s.findings.filter((f) => f.code === 'F1c').map((f) => [f.account, f.branch, f.verba])).toEqual([[NET_ACCOUNT, '02', 'A20']]);
    expect(s.workpaperStatuses).toEqual([]);

    // The session answers the side panel of an account and the tables.
    const detail = (await r.query({ type: 'account', index: 1 }, 'account')).data;
    expect(detail.bridge!.closes).toBe(true);
    expect(detail.bridge!.parcels.reduce((t, p) => t + p.amount, 0)).toBe(detail.row.balance);
    expect(detail.settlement!.settled.map((l) => l.settled)).toEqual([true, true, true]);
    expect(detail.narrative).toMatch(/^Fizemos a comparação do saldo da conta/);
    const page = await r.query({ type: 'page', scope: 0, table: 'concLedger', filter: { conc: { account: 1 } }, offset: 0, limit: 2000 }, 'page');
    expect(page.total).toBe(page.rows.length);
    expect(page.documents).toEqual(page.rows.map(() => 1));
  });

  it('accepts the same ledger in TXT and in XML (V-3) and the same GPER040 twice', async () => {
    const fx = engineFixture();
    const files = sessionFiles(fx, [{ format: 'text' }, { format: 'xml' }]);
    const r = await ingest([...files, { ...files[0]!, name: 'GPER040-copia.txt' }], configOf(fx.profile));
    expect(failing(r.reconciliation!)).toEqual([]);
    const v3 = r.reconciliation!.checks.find((c) => c.id === 'V-3')!;
    expect(v3.message).toBe('2 par(es) de arquivos do mesmo relatório com leituras iguais.');
    expect((r.reconciliation!.files[3] as PayrollFileCard).used).toBe(false);
    expect(r.reconciliation!.alerts.some((a) => a.level === 'info' && a.message.includes('a análise usa GPER040.##R'))).toBe(true);
  });

  it('blocks with the first divergence when the two formats of the same ledger differ (V-3, R-7)', async () => {
    const fx = engineFixture();
    const other = structuredClone(fx.ledger);
    const line = other.accounts.find((a) => a.code === VERBAS_ACCOUNT)!.entries.find((e) => e.credit !== undefined)!;
    line.credit = line.credit! + 1;
    const r = await ingest(sessionFiles(fx, [{ format: 'text' }, { format: 'xml', fixture: other }]), configOf(fx.profile));
    expect(r.error).toBeNull();
    expect(failing(r.reconciliation!)).toEqual(['R-7', 'V-3']);
    const v3 = r.reconciliation!.checks.find((c) => c.id === 'V-3')!;
    expect(v3.severity).toBe('error');
    expect(v3.message).toMatch(/^CTBR400-1\.__r × CTBR400-2\.xml: primeira divergência em conta 9\.9\.1\.0\.10\.02, lançamento \d+: crédito: /);
    expect(r.summary!.blocking).toBe(2);
  });

  it('keeps a failing reading invariant on the board, blocking, and still answers the analysis', async () => {
    const fx = engineFixture();
    fx.payroll = payrollSpool(undefined, { defect: 'L-2' });
    const r = await ingest(sessionFiles(fx), configOf(fx.profile));
    expect(r.error).toBeNull();
    expect(failing(r.reconciliation!)).toContain('L-2');
    expect(r.reconciliation!.checks.find((c) => c.id === 'L-2')!.message).toContain(`linha`);
    expect(r.summary!.blocking).toBeGreaterThan(0);
  });

  it('needs a payroll and a ledger; a file of the provisions (Phase 16) is listed, not read', async () => {
    const fx = engineFixture();
    const [payroll, ledger] = sessionFiles(fx);
    const onlyPayroll = await ingest([payroll!, stranger], configOf(fx.profile));
    expect(onlyPayroll.error).toMatchObject({ stage: 'reconciliation', message: 'A análise precisa de ao menos um razão (CTBR400) e uma folha (GPER040); falta um razão (CTBR400).' });
    expect(onlyPayroll.error!.detail).toBe('GPER040.##R: GPER040; anotacoes.txt: não reconhecido');
    const onlyLedger = await ingest([ledger!], configOf(fx.profile));
    expect(onlyLedger.error?.message).toMatch(/falta a folha \(GPER040\)\.$/);
    const provision = { name: 'GPER070.##R', bytes: new TextEncoder().encode('*****\r\n* EMPRESA X   SIGA /GPER070/v.12   Pagina: 1 *\r\n*****\r\n') };
    const r = await ingest([payroll!, ledger!, provision], configOf(fx.profile));
    expect(r.reconciliation!.files[2]).toMatchObject({ kind: 'other', report: 'GPER070' });
    expect(r.reconciliation!.alerts[0]!.message).toBe(
      'GPER070.##R: GPER070 (provisão de férias) reconhecido: a leitura dos relatórios de provisão ainda não está disponível nesta versão; o arquivo fica fora da análise e as contas de provisão, não analisadas.',
    );
  });

  it('a provision account is "não analisada — falta <relatório>" without its report, and waits for the reader with it', async () => {
    const fx = engineFixture();
    const [payroll, ledger] = sessionFiles(fx);
    const profile = provisionProfileFile();
    const without = await ingest([payroll!, ledger!], configOf(profile));
    expect(without.summary!.accounts[3]).toMatchObject({ account: '9.9.1.0.30.01', status: 'notAnalyzed', reason: 'não analisada — falta GPER070' });
    const provision = { name: 'ferias.__r', bytes: new TextEncoder().encode('*****\r\n* EMPRESA X   SIGA /GPER070/v.12   Pagina: 1 *\r\n*****\r\n') };
    const other = { name: '13o.__r', bytes: new TextEncoder().encode('*****\r\n* EMPRESA X   SIGA /GPER090/v.12   Pagina: 1 *\r\n*****\r\n') };
    // With the GPER070 (and a GPER090 the profile does not use), the account is held to CC-1: it is not in the ledger.
    const withReport = await ingest([payroll!, ledger!, provision, other], configOf(profile));
    expect(withReport.summary!.accounts[3]).toMatchObject({ status: 'notInLedger' });
    expect(withReport.reconciliation!.alerts.map((a) => a.message.split(' reconhecido:')[0])).toEqual(['ferias.__r: GPER070 (provisão de férias)', '13o.__r: GPER090 (provisão de 13º salário)']);
  });

  it('stops on a ledger whose layout is not the documented one (title out of position)', async () => {
    const fx = engineFixture();
    const files = sessionFiles(fx);
    files[1] = { name: 'razao.__r', bytes: ledgerSpool(fx.ledger, { titleShift: 2 }) };
    const r = await ingest(files, configOf(fx.profile));
    expect(r.error).toMatchObject({ stage: 'rows' });
    expect(r.error!.message).toMatch(/^razao\.__r: /);
  });

  it('lists an account of the profile out of the ledger as out of the analysis (CC-1, warning)', async () => {
    const fx = engineFixture();
    fx.ledger.accounts = fx.ledger.accounts.filter((a) => a.code !== ASSET_ACCOUNT);
    const r = await ingest(sessionFiles(fx), configOf(fx.profile));
    expect(failing(r.reconciliation!)).toEqual(['CC-1']);
    expect(r.reconciliation!.checks.find((c) => c.id === 'CC-1')!.severity).toBe('warning');
    expect(r.summary!.accounts[2]).toMatchObject({ status: 'notInLedger', expected: null, balance: null, situation: null });
    expect(r.summary!.figures).toMatchObject({ accounts: 3, analyzed: 2 });
  });
});
