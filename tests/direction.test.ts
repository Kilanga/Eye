import { describe, expect, it } from 'vitest';
import { fitsDirection } from '../src/core/direction';

describe('model answers must match the direction of the money', () => {
  it('refuses income on money going out', () => {
    expect(fitsDirection('income_other', -12.5)).toBe(false);
    expect(fitsDirection('income_salary', -2000)).toBe(false);
    expect(fitsDirection('refund', -20)).toBe(false);
  });
  it('refuses spending categories on money coming in', () => {
    expect(fitsDirection('housing', 1400)).toBe(false);
    expect(fitsDirection('groceries', 30)).toBe(false);
  });
  it('accepts categories that can go both ways', () => {
    for (const c of ['payday_loan', 'gambling', 'p2p_transfer', 'internal_transfer', 'other'] as const) {
      expect(fitsDirection(c, 100)).toBe(true);
      expect(fitsDirection(c, -100)).toBe(true);
    }
  });
});
