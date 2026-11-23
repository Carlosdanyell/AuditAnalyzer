/**
 * The real payroll profile of the Conciliador, in local/conciliador/ (docs/FASE_15_CONCILIADOR_FOLHA.md, section 6.3):
 * it passes the schema of section 6 of docs/REGRAS_CONCILIADOR.md as it is imported on the Configuração screen, and the
 * synthetic profiles of the public tests share no account, verba or batch prefix with it. Prints only "ok" or the paths
 * of the issues, never the content (messages can quote codes). Skipped when the file is absent.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPayrollProfileFile, reconciliationDefaultConfig } from '../../src/config/reconciliationSchema';
import { payrollProfileFile, provisionProfileFile } from '../synthetic/reconciliationProfile';
import { localDir } from './realFiles';

const path = join(localDir, 'conciliador', 'perfil-folha.json');
const present = existsSync(path);

/** Codes of a profile file, whatever their shape (valid or not), to compare without printing them. */
function codesOf(profile: unknown): { accounts: Set<string>; verbas: Set<string>; prefixes: Set<string> } {
  const p = (profile ?? {}) as {
    payrollReport?: { netPayCode?: string };
    ledger?: { batchClasses?: { match?: { prefix?: string } }[] };
    accounts?: { account?: string; netPayCode?: string; verbas?: unknown; settlementVerbas?: string[] }[];
  };
  const verbas = new Set<string>([p.payrollReport?.netPayCode ?? '']);
  for (const a of p.accounts ?? []) {
    if (a.netPayCode) verbas.add(a.netPayCode);
    for (const s of a.settlementVerbas ?? []) verbas.add(s);
    const v = a.verbas;
    if (Array.isArray(v)) for (const x of v as { code?: string }[]) verbas.add(x.code ?? '');
    else if (v && typeof v === 'object') for (const list of Object.values(v as Record<string, string[]>)) for (const c of list) verbas.add(c);
  }
  verbas.delete('');
  return {
    accounts: new Set((p.accounts ?? []).map((a) => a.account ?? '').filter(Boolean)),
    verbas,
    prefixes: new Set((p.ledger?.batchClasses ?? []).map((b) => b.match?.prefix ?? '').filter(Boolean)),
  };
}

describe.skipIf(!present)('real payroll profile (local/conciliador/perfil-folha.json)', () => {
  it('passes the schema of the profile file', () => {
    const read = readPayrollProfileFile(JSON.parse(readFileSync(path, 'utf8')));
    const issues = read.ok ? [] : read.errors.map((e) => e.path || '(raiz)');
    console.log(read.ok ? `ok (${read.warnings.length} aviso(s): ${read.warnings.map((w) => w.path).join(', ') || 'nenhum'})` : `problemas em: ${issues.join(', ')}`);
    expect(issues).toEqual([]);
  });

  it('shares no account, verba or batch prefix with the synthetic profiles nor with the default', () => {
    const real = codesOf(JSON.parse(readFileSync(path, 'utf8')));
    const shared: string[] = [];
    for (const synthetic of [payrollProfileFile(), provisionProfileFile(), { schemaVersion: 1, profile: 'payroll', ...reconciliationDefaultConfig().profiles.payroll }]) {
      const s = codesOf(synthetic);
      for (const kind of ['accounts', 'verbas', 'prefixes'] as const) if ([...s[kind]].some((c) => real[kind].has(c))) shared.push(kind);
    }
    console.log(shared.length === 0 ? 'ok' : `códigos em comum: ${[...new Set(shared)].join(', ')}`);
    expect(shared).toEqual([]);
  });
});
