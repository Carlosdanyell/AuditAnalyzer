import { describe, expect, it } from 'vitest';
import { defaultConfig, parseConfig } from '../../src/config/schema';

describe('analyzer configuration', () => {
  it('default CT2 configuration is valid', () => {
    const config = defaultConfig();
    expect(config.schemaVersion).toBe(1);
    expect(config.table).toBe('CT2');
    expect(Object.values(config.columns)).toEqual([
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
    expect(Object.values(config.operations)).toEqual(['Inclusão', 'Alteração', 'Exclusão', 'Recuperação']);
  });

  it('rejects an unknown schema version', () => {
    expect(() => parseConfig({ ...defaultConfig(), schemaVersion: 2 })).toThrow();
  });

  it('rejects two roles mapped to the same report column', () => {
    const config = defaultConfig();
    expect(() => parseConfig({ ...config, columns: { ...config.columns, user: 'Campo' } })).toThrow();
  });

  it('rejects a missing operation label', () => {
    const config = defaultConfig();
    expect(() => parseConfig({ ...config, operations: { ...config.operations, restore: '' } })).toThrow();
  });
});
