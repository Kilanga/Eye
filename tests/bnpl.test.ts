import { describe, expect, it } from 'vitest';
import { classifyByKeywords } from '../src/core/keywords';
import type { Transaction } from '../src/core/types';

const line = (rawLabel: string, amount: number): Transaction => ({
  id: rawLabel,
  accountId: 'a',
  date: '2026-10-01',
  amount,
  currency: 'USD',
  country: 'US',
  rawLabel,
});

describe('buy now, pay later', () => {
  it('reads instalment providers as debt payments', () => {
    for (const label of ['AFFIRM *PAYMENT 7731', 'KLARNA*SHOE OUTLET', 'AFTERPAY 0042', 'SEZZLE INC', 'PAYPAL PAY IN 3', 'PRLV SEPA ONEY BANK 3X', 'FLOA BANK ECHEANCE', 'SCALAPAY 2/3']) {
      expect(classifyByKeywords(line(label, -45.1)), label).toBe('bnpl');
    }
  });

  it('leaves refunds and look-alike words alone', () => {
    expect(classifyByKeywords(line('KLARNA REFUND', 45.1))).toBe('refund');
    expect(classifyByKeywords(line('MONEY TRANSFER FEE', -5))).not.toBe('bnpl');
    expect(classifyByKeywords(line('FLOATING DOCK RENTAL', -60))).not.toBe('bnpl');
    expect(classifyByKeywords(line('AFFIRMATIONS BOOKSHOP', -18))).not.toBe('bnpl');
  });
});
