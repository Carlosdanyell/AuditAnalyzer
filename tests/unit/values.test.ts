import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/config/schema';
import { displayValue } from '../../src/worker/engine/values';

describe('values shown to the reader', () => {
  const config = defaultConfig();

  it('replaces the encoded user/date stamp by a dash', () => {
    expect(displayValue(config, 'CT2_USERGA', '0#  9@= 50F 303')).toBe('—');
    expect(displayValue(config, 'CT2_USERGA', '')).toBe('');
  });

  it('adds the configured description to codes (balance type and entry type)', () => {
    expect(displayValue(config, 'CT2_TPSALD', '9')).toBe('9 — Pré-lançamento');
    expect(displayValue(config, 'CT2_TPSALD', '1')).toBe('1 — Saldo real');
    expect(displayValue(config, 'CT2_DC', '1')).toBe('1 — Débito');
    expect(displayValue(config, 'CT2_TPSALD', '3')).toBe('3');
  });

  it('keeps any other value unchanged and accepts a translation of the descriptions', () => {
    expect(displayValue(config, 'CT2_HIST', 'PAGTO FORNECEDOR')).toBe('PAGTO FORNECEDOR');
    expect(displayValue(config, 'CT2_TPSALD', '9', () => 'Pre-posting')).toBe('9 — Pre-posting');
  });
});
