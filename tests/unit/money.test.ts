import { describe, expect, it } from 'vitest';
import { MONEY_EMPTY, MONEY_INVALID, parseCents } from '../../src/shared/money';

describe('CT2_VALOR → integer cents', () => {
  it.each([
    ['1234.56', 123456],
    ['1234', 123400],
    ['0.5', 50],
    ['0.05', 5],
    ['0', 0],
    [' 12.30 ', 1230],
    ['9876543.21', 987654321],
    ['99999999999.99', 9999999999999],
  ])('%j → %i', (text, cents) => {
    expect(parseCents(text)).toBe(cents);
  });

  it('distinguishes an empty value', () => {
    expect(parseCents('')).toBe(MONEY_EMPTY);
    expect(parseCents('   ')).toBe(MONEY_EMPTY);
  });

  it.each(['1,50', '1.234', '1.', '.5', 'abc', '-5.00', '1 000.00', '1e3', '12.3.4'])('rejects %j (never rounds)', (text) => {
    expect(parseCents(text)).toBe(MONEY_INVALID);
  });
});
