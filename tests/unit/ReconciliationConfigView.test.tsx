import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readPayrollProfileFile, reconciliationDefaultConfig, withPayrollProfile } from '../../src/config/reconciliationSchema';
import { configViewOf } from '../../src/app/moduleViews';
import { ReconciliationConfigView } from '../../src/app/views/ReconciliationConfigView';
import { reconciliationModule } from '../../src/modules/reconciliation/module';
import { payrollProfileFile } from '../synthetic/reconciliationProfile';

/** Configuração screen of the Conciliador (docs/REGRAS_CONCILIADOR.md, section 6). */
const props = {
  onSave: async () => true,
  holidays: [],
  analysisLoaded: false,
  needsReprocess: false,
  canReprocess: false,
  onReprocess: () => {},
  onClose: () => {},
};

describe('Conciliador configuration screen', () => {
  it('is the configuration screen of the module, found by its descriptor', () => {
    expect(configViewOf(reconciliationModule)).toBe(ReconciliationConfigView);
  });

  it('without accounts: says the profile is missing and offers to import and export it', () => {
    const html = renderToStaticMarkup(<ReconciliationConfigView config={reconciliationDefaultConfig()} {...props} />);
    expect(html).toContain('Perfil sem contas: importe o perfil de contas para analisar.');
    expect(html).toContain('Importar perfil (JSON)');
    expect(html).toContain('Exportar perfil (JSON)');
    expect(html).toMatch(/<input[^>]*accept=".json,application\/json"[^>]*aria-label="Arquivo do perfil de contas \(JSON\)"/);
    expect(html).toContain('Nenhuma conta no rascunho.');
  });

  it('with a profile: one row per account with its tick mark, pattern, side and criterion', () => {
    const read = readPayrollProfileFile(payrollProfileFile());
    if (!read.ok) throw new Error('invalid');
    const html = renderToStaticMarkup(<ReconciliationConfigView config={withPayrollProfile(reconciliationDefaultConfig(), read.profile)} {...props} />);
    expect(html).toContain('Perfil com 3 conta(s).');
    expect(html).toContain('Contas do perfil (3)');
    expect(html).toContain('verba do líquido X99');
    expect(html).toContain('B20, 7AB');
    expect(html).toContain('A10; baixa: C31');
    expect(html).toContain('Credora');
    expect(html).toContain('Devedora');
  });
});
