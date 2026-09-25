import { describe, expect, it } from 'vitest';
import { defaultConfig, parseConfig } from '../../src/config/schema';

describe('analyzer configuration', () => {
  it('default CT2 configuration is valid', () => {
    const config = defaultConfig();
    expect(config.schemaVersion).toBe(1);
    expect(config.table).toBe('CT2');
    expect(config.reportColumns).toEqual([
      'Campo',
      'Vlr Antigo',
      'Vlr Atualizado',
      'Tipo Dados',
      'Recno',
      'Usuario',
      'Operacao',
      'Data Hora',
      'Situacao',
      'Tipo Dado Protegido',
    ]);
  });

  it('rejects an unknown schema version', () => {
    expect(() => parseConfig({ ...defaultConfig(), schemaVersion: 2 })).toThrow();
  });

  it('rejects duplicated report columns', () => {
    expect(() => parseConfig({ ...defaultConfig(), reportColumns: ['Campo', 'Campo'] })).toThrow();
  });
});
