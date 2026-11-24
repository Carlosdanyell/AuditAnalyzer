/**
 * Ingestion of the Conciliador with the real files through the worker handler (Phase 15, step 5; never versioned data):
 * the real profile, the real GPER040 and the real ledger of the net pay account (TXT). The other accounts of the profile
 * have their ledger only in the workpaper's sheet "3", which is not a format of the screen: they are expected out of the
 * analysis. Prints to the console only the board, the key figures and the row of the net pay account (its code and name
 * masked), the time and the memory. Skipped when local/conciliador is absent.
 */
import { existsSync, readFileSync } from 'node:fs';
import { openAsBlob } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPayrollProfileFile, reconciliationDefaultConfig, withPayrollProfile } from '../../src/config/reconciliationSchema';
import type { ReconciliationReconciliation, ReconciliationSummary } from '../../src/shared/modules/reconciliation';
import type { WorkerEvent } from '../../src/shared/protocol';
import { createCommandHandler } from '../../src/worker/handler';
import { localDir } from './realFiles';

const dir = join(localDir, 'conciliador');
const file = (name: string) => join(dir, name);
const NAMES = ['perfil-folha.json', 'gper040-2026-10.txt', 'ctbr400-liquido.__r'];
const present = NAMES.every((n) => existsSync(file(n)));
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

describe.skipIf(!present)('ingestion of the Conciliador with the real files (local/conciliador)', () => {
  it('reads, reconciles and analyzes the net pay account; the others are out of the analysis', async () => {
    const read = readPayrollProfileFile(JSON.parse(readFileSync(file('perfil-folha.json'), 'utf8')));
    if (!read.ok) throw new Error(JSON.stringify(read.errors));
    const config = withPayrollProfile(reconciliationDefaultConfig(), read.profile);
    const files = await Promise.all(['gper040-2026-10.txt', 'ctbr400-liquido.__r'].map(async (n) => new File([await openAsBlob(file(n))], n)));

    global.gc?.();
    const before = process.memoryUsage();
    let peak = before.heapUsed;
    const events: WorkerEvent[] = [];
    const handle = createCommandHandler((e) => {
      events.push(e);
      peak = Math.max(peak, process.memoryUsage().heapUsed);
    });
    const t0 = performance.now();
    await handle({ type: 'ingest', module: 'reconciliation', files, config });
    const ms = performance.now() - t0;
    const after = process.memoryUsage();

    const error = events.find((e) => e.type === 'error');
    expect(error).toBeUndefined();
    const recon = (events.find((e) => e.type === 'reconciliation') as Extract<WorkerEvent, { type: 'reconciliation' }>).data as ReconciliationReconciliation;
    const summary = (events.find((e) => e.type === 'ready') as Extract<WorkerEvent, { type: 'ready' }>).summary as ReconciliationSummary;

    console.log(`Arquivos: ${recon.files.map((f) => `${f.name} → ${f.kind}${'format' in f ? ` (${f.format})` : ''}`).join('; ')}`);
    console.log(`Quadro: ${recon.checks.map((c) => `${c.id} ${c.passed ? 'OK' : c.severity === 'error' ? 'FALHA' : 'ALERTA'}`).join(' · ')}`);
    for (const c of recon.checks.filter((x) => !x.passed)) console.log(`  ${c.id}: ${c.message.replace(/\d+(\.\d+)+/g, '«conta»')}`);
    console.log('Indicadores:', JSON.stringify(summary.figures), 'competência', summary.period);
    const net = summary.accounts.find((a) => a.mode === 'netPay' && a.status === 'analyzed');
    for (const a of summary.accounts) {
      const shown = a === net ? '[netPay]' : '';
      console.log(
        `${a.tickMark} ${shown} padrão ${a.pattern} ${a.status}${a.reason ? ` (${a.reason})` : ''}` +
          (a.status === 'analyzed'
            ? ` esperado ${a.expected} real ${a.balanceReal} pré ${a.balancePreEntry} contábil ${a.balance} diferença ${a.difference} situação ${a.situation} baixa ${a.settlement?.situation} (${a.settlement?.lines} lançamentos, ${a.settlement?.amount}) achados ${JSON.stringify(a.findings)} ponte ${a.bridgeCloses ? 'fecha' : 'NÃO fecha'}`
            : ''),
      );
    }
    console.log(`F1c: ${summary.findings.filter((f) => f.code === 'F1c').map((f) => `filial ${f.branch} verba ${f.verba}`).join('; ')}`);
    console.log(`Tempo: ${ms.toFixed(0)} ms (reconciliação ${recon.totalMs} ms); heap antes ${mb(before.heapUsed)}, pico ${mb(peak)}, depois ${mb(after.heapUsed)}; rss depois ${mb(after.rss)}`);

    expect(net).toBeDefined();
    expect(net!.bridgeCloses).toBe(true);
    expect(summary.accounts.filter((a) => a.status === 'analyzed')).toHaveLength(1);
  });
});
