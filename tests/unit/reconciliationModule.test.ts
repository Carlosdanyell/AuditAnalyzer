import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/config/schema';
import { readPayrollProfileFile, reconciliationDefaultConfig, withPayrollProfile, type ReconciliationConfig } from '../../src/config/reconciliationSchema';
import { reconciliationModule } from '../../src/modules/reconciliation/module';
import { getModule, resolveInitialModule } from '../../src/modules/registry';
import { buildBackup, readBackup } from '../../src/shared/backup';
import { moduleConfigKey, planModuleConfigLoad } from '../../src/shared/configStorage';
import type { WorkerEvent } from '../../src/shared/protocol';
import { createCommandHandler } from '../../src/worker/handler';
import { payrollProfileFile } from '../synthetic/reconciliationProfile';

/** The Conciliador on the platform (Phase 15, step 1): descriptor, configuration on this computer, backup and worker. */
function profiled(): ReconciliationConfig {
  const read = readPayrollProfileFile(payrollProfileFile());
  if (!read.ok) throw new Error(JSON.stringify(read.errors));
  return withPayrollProfile(reconciliationDefaultConfig(), read.profile);
}

describe('descriptor of the Conciliador', () => {
  it('is registered, in preview, with every view and its own help section', () => {
    expect(getModule('reconciliation')).toBe(reconciliationModule);
    const m = reconciliationModule;
    expect(m).toMatchObject({ status: 'available', id: 'reconciliation', title: 'Conciliador', shortTitle: 'CONC', helpAnchor: 'reconciliation', icon: 'reconcile' });
    expect(m.preview).toMatch(/^Prévia/);
    expect(m.features).toEqual({ panel: true, findings: true, tables: true, justifications: true, export: true });
    expect(m.highlights.length).toBeGreaterThanOrEqual(2);
    expect(m.highlights.length).toBeLessThanOrEqual(3);
    expect(m.config.saved).toBe(true);
    expect(m.config.defaults()).toEqual(reconciliationDefaultConfig());
    expect(resolveInitialModule('reconciliation')).toBe('reconciliation');
  });

  it('takes any file and decides by its content, with the hint of the file picker (section 3.2)', () => {
    expect(reconciliationModule.accepts).toEqual({ extensions: 'any', hint: 'TXT do spool, PDF, XML ou XLSX exportados do Protheus', maxFiles: 255 });
  });

  it('is not ready to analyze without a profile with accounts', () => {
    expect(reconciliationModule.notReady!(reconciliationDefaultConfig())).toBe('Importe o perfil de contas na Configuração');
    expect(reconciliationModule.notReady!(profiled())).toBeNull();
  });
});

describe('configuration of the Conciliador on this computer', () => {
  it('lives under analyzerConfig:reconciliation: absent = default; saved = read back; invalid = default with a notice', () => {
    expect(moduleConfigKey('reconciliation')).toBe('analyzerConfig:reconciliation');
    const m = reconciliationModule.config;
    expect(planModuleConfigLoad(undefined, m)).toEqual({ config: reconciliationDefaultConfig(), notice: null, write: false });
    expect(planModuleConfigLoad(profiled(), m)).toEqual({ config: profiled(), notice: null, write: false });
    const invalid = planModuleConfigLoad({ schemaVersion: 9 }, m);
    expect(invalid.config).toEqual(reconciliationDefaultConfig());
    expect(invalid.notice).toMatch(/inválida/);
  });

  it('is kept by the backup of version 3 and restored as it was, without changing the version', () => {
    const readers = { reconciliation: { label: 'Conciliador', read: reconciliationModule.config.read } };
    const text = buildBackup(defaultConfig(), [], '2026-11-23 10:00:00', { reconciliation: profiled() });
    expect(JSON.parse(text)).toMatchObject({ version: 3, modules: { reconciliation: profiled() } });
    const read = readBackup(text, readers);
    expect(read.ok && read.modules).toEqual({ reconciliation: profiled() });
    // An invalid profile inside the backup is reported by the name of the module.
    const broken = JSON.parse(text) as { modules: { reconciliation: { profiles: { payroll: { accounts: unknown[] } } } } };
    broken.modules.reconciliation.profiles.payroll.accounts.push(broken.modules.reconciliation.profiles.payroll.accounts[0]);
    const refused = readBackup(JSON.stringify(broken), readers);
    expect(refused.ok ? [] : refused.errors).toEqual(['Configuração de Conciliador — profiles.payroll.accounts.3.account: Conta repetida: 9.9.1.0.10.01 também está na conta 1 da lista.']);
  });
});

describe('worker of the Conciliador', () => {
  const run = async (config: unknown) => {
    const events: WorkerEvent[] = [];
    await createCommandHandler((e) => events.push(e))({ type: 'ingest', module: 'reconciliation', files: [new File(['x'], 'SPOOL.##R')], config });
    return events;
  };

  it('is dispatched by the platform and says the reading is not there yet (steps 2 to 4)', async () => {
    expect(await run(profiled())).toEqual([
      { type: 'error', stage: 'fileCheck', message: 'Leitura do Conciliador ainda não implementada.', detail: expect.stringContaining('etapas 2 a 4') },
    ]);
  });

  it('refuses an invalid configuration, as every module does', async () => {
    expect(await run({ schemaVersion: 1 })).toEqual([{ type: 'error', stage: 'fileCheck', message: 'Configuração inválida.', detail: expect.stringContaining('profiles') }]);
  });
});
