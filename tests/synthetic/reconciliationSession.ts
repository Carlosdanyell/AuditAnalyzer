/**
 * A synthetic session of the Conciliador (Phase 15, step 5): the GPER040 spool and the ledger of the engine fixture
 * (tests/synthetic/payrollLedgerFixture.ts) as files, with the configuration that carries the synthetic profile. Used by
 * the unit tests of the worker ingest and of the panel, and by the e2e tests (written to disk). Invented data only.
 */
import { readPayrollProfileFile, reconciliationDefaultConfig, withPayrollProfile, type PayrollProfileFile, type ReconciliationConfig } from '../../src/config/reconciliationSchema';
import { ledgerSpool, ledgerXml, type LedgerFixture } from './ledgerFixture';
import { engineCases, engineFixture, splitByType, type EngineFixture } from './payrollLedgerFixture';

/** The configuration of the module with the profile of the fixture (as the Configuração screen saves it). */
export function configOf(profile: PayrollProfileFile): ReconciliationConfig {
  const read = readPayrollProfileFile(profile);
  if (!read.ok) throw new Error(JSON.stringify(read.errors));
  return withPayrollProfile(reconciliationDefaultConfig(), read.profile);
}

export interface SessionFile {
  name: string;
  bytes: Uint8Array;
}

const utf8 = (s: string) => new TextEncoder().encode(s);

/** The GPER040 and the ledger in the format asked: `.__r`/`.##r` names, as the spool comes. */
export function sessionFiles(fx: EngineFixture, ledger: { format: 'text' | 'xml'; fixture?: LedgerFixture; name?: string }[] = [{ format: 'text' }]): SessionFile[] {
  return [
    { name: 'GPER040.##R', bytes: fx.payroll.bytes },
    ...ledger.map((l, i) => ({
      name: l.name ?? (l.format === 'text' ? `CTBR400-${i + 1}.__r` : `CTBR400-${i + 1}.xml`),
      bytes: l.format === 'text' ? ledgerSpool(l.fixture ?? fx.ledger) : utf8(ledgerXml(l.fixture ?? fx.ledger)),
    })),
  ];
}

/**
 * The fixture of the e2e and of the screen tests: the base with the A20 provento of branch 02 posted by hand in the net
 * pay account (one F1c, difference zero), the opening balance of the verbas account paid in three payments (F3
 * identified) and the ledger in two extractions, real (September) and pre-entry (October).
 */
export function screenFixture(): { fx: EngineFixture; real: LedgerFixture; preEntry: LedgerFixture } {
  const fx = engineFixture();
  engineCases.manualProvento(fx);
  engineCases.settledInThree(fx);
  const { real, preEntry } = splitByType(fx.ledger);
  return { fx, real, preEntry };
}

/** A profile file with the situations of the user's workpaper (`workpaperStatuses`), for the Justificativas. */
export function profileWithStatuses(profile: PayrollProfileFile): PayrollProfileFile {
  return { ...profile, workpaperStatuses: ['Conciliado', 'Pendente de ajuste', 'Em análise'] };
}
