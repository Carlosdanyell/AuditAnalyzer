import { describe, expect, it } from 'vitest';
import { applySettings, normalizeSettings } from '../../src/shared/settings';
import { defaultConfig } from '../../src/config/schema';

describe('user settings (presets and holidays)', () => {
  it('applies saved presets and holidays over the default configuration', () => {
    const config = applySettings(defaultConfig(), {
      periodPresets: [{ label: 'Fechamento', start: '01/09/2026', end: '04/09/2026' }],
      holidays: ['07/09/2026'],
    });
    expect(config.panel.periodPresets).toEqual([{ label: 'Fechamento', start: '01/09/2026', end: '04/09/2026' }]);
    expect(config.calendar.holidays).toEqual(['07/09/2026']);
  });

  it('has no fixed windows or holidays by default', () => {
    expect(defaultConfig().panel.periodPresets).toEqual([]);
    expect(defaultConfig().calendar.holidays).toEqual([]);
  });

  it('drops invalid entries, sorts holidays and removes duplicates', () => {
    expect(
      normalizeSettings({
        periodPresets: [
          { label: ' ', start: '01/09/2026', end: '02/09/2026' },
          { label: 'Invertido', start: '05/09/2026', end: '01/09/2026' },
          { label: 'Ok', start: '01/09/2026', end: '02/09/2026' },
        ],
        holidays: ['07/09/2026', '31/02/2026', '15/11/2026', '07/09/2026'],
      }),
    ).toEqual({
      periodPresets: [{ label: 'Ok', start: '01/09/2026', end: '02/09/2026' }],
      holidays: ['07/09/2026', '15/11/2026'],
    });
  });

  it('ignores stored data that is not a settings object', () => {
    expect(normalizeSettings('lixo' as never)).toEqual({ periodPresets: [], holidays: [] });
  });
});
