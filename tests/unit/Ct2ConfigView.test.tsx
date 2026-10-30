import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ct2DefaultConfig } from '../../src/config/ct2IntegritySchema';
import { configViewOf } from '../../src/app/moduleViews';
import { Ct2ConfigView } from '../../src/app/views/Ct2ConfigView';
import { cfgr700Module } from '../../src/modules/cfgr700/module';
import { ct2IntegrityModule } from '../../src/modules/ct2Integrity/module';

/** Configuração screen of the CT2 module (docs/REGRAS_CT2_INTEGRIDADE.md, sections 2-6). */
const props = {
  onSave: async () => true,
  holidays: ['07/09/2026'],
  analysisLoaded: false,
  needsReprocess: false,
  canReprocess: false,
  onReprocess: () => {},
  onClose: () => {},
};

describe('CT2 configuration screen', () => {
  it('is the configuration screen of the CT2 module; the CFGR700 keeps its own', () => {
    expect(configViewOf(ct2IntegrityModule)).toBe(Ct2ConfigView);
    expect(configViewOf(cfgr700Module)).toBeNull();
  });

  it('lists every test with its switch and severity; the B4 diagnostic and the profile stay Info', () => {
    const html = renderToStaticMarkup(<Ct2ConfigView config={ct2DefaultConfig()} {...props} />);
    expect(html).toContain('Configuração padrão, sem alterações.');
    for (const code of ['B1', 'B5', 'I4', 'E6', 'P4']) expect(html).toContain(`aria-label="Ligar ${code}"`);
    expect(html).toMatch(/<select[^>]*disabled=""[^>]*aria-label="Severidade de B4"/);
    expect(html).not.toMatch(/<select[^>]*disabled=""[^>]*aria-label="Severidade de B1"/);
    expect(html).toContain('Limite de linhas por documento (P4)');
    expect(html).toContain('usados no E6 (dia não útil): 07/09/2026');
  });

  it('shows the differences from the default', () => {
    const config = ct2DefaultConfig();
    config.parameters.toleranceCents = 5;
    config.tests.I5.enabled = false;
    const html = renderToStaticMarkup(<Ct2ConfigView config={config} {...props} />);
    expect(html).toContain('2 diferença(s) em relação ao padrão.');
    expect(html).toContain('parameters.toleranceCents');
  });
});
