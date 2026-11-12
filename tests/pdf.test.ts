import { describe, expect, it } from 'vitest';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractPdfLines } from '../src/core/import/pdf';
import { chunkLines, parseWithLayout, readDate, validateModelItems } from '../src/core/import/statement-text';
import { frClean, usAlmostReady } from '../src/demo/generate';
import { accountToPdf } from '../src/demo/statement-pdf';

const sum = (xs: { amount: number }[]) => Math.round(xs.reduce((s, x) => s + x.amount, 0) * 100) / 100;

describe('PDF statements, end to end on the device', () => {
  for (const [name, persona] of [['US', usAlmostReady], ['FR', frClean]] as const) {
    it(`reads back every line of the ${name} sample`, async () => {
      const acc = persona().accounts[0];
      const bytes = await accountToPdf(acc, 'Sample');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lines = await extractPdfLines(pdfjs as any, bytes);
      const opts = { accountId: 'pdf', currency: acc.currency, country: acc.country };
      const r = parseWithLayout(lines, opts, 2000);
      expect(r.method).toBe('layout');
      expect(r.unreadLines).toBe(0);
      expect(r.transactions).toHaveLength(acc.transactions.length);
      expect(sum(r.transactions)).toBe(sum(acc.transactions));
      const src = acc.transactions.slice().sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount);
      const got = r.transactions.slice().sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount);
      expect(got.map((t) => t.date)).toEqual(src.map((t) => t.date));
      expect(chunkLines(lines).every((c) => c.length <= 6200)).toBe(true);
    });
  }
});

describe('statement text helpers', () => {
  it('reads dates by country and infers the year', () => {
    expect(readDate('09/14', 'US', 2026)).toBe('2026-09-14');
    expect(readDate('14/09', 'FR', 2026)).toBe('2026-09-14');
    expect(readDate('Sep 14', 'US', 2026)).toBe('2026-09-14');
    expect(readDate('2026-09-14', 'FR', 1999)).toBe('2026-09-14');
    expect(readDate('Total', 'US', 2026)).toBeNull();
  });

  it('drops model output that the page does not support', () => {
    const chunk = '09/03 | BRIGHTWAVE LABS PAYROLL | 2,450.00 | 5,650.00\n09/05 | SUMMIT AUTO LOAN PMT | 385.00';
    const opts = { accountId: 'a', currency: 'USD', country: 'US' as const };
    const kept = validateModelItems(
      [
        { date: '2026-09-03', label: 'BRIGHTWAVE LABS PAYROLL', amount: 2450 },
        { date: '2026-09-05', label: 'SUMMIT AUTO LOAN PMT', amount: -385 },
        { date: '2026-09-06', label: 'INVENTED SHOP', amount: -12.5 },
        { date: '2026-09-07', label: 'SUMMIT AUTO LOAN PMT', amount: -999 },
        { date: 'yesterday', label: 'SUMMIT', amount: -385 },
      ],
      chunk,
      opts,
      0,
    );
    expect(kept.map((t) => t.amount)).toEqual([2450, -385]);
  });
});

describe('unusual PDF layout', () => {
  it('is not guessed by the layout rules: it goes to Gemini Nano', async () => {
    const acc = usAlmostReady().accounts[0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lines = await extractPdfLines(pdfjs as any, await accountToPdf(acc, 'Sample', 'compact'));
    const r = parseWithLayout(lines, { accountId: 'x', currency: 'USD', country: 'US' }, 2026);
    expect(r.method).toBe('none');
    expect(chunkLines(lines).length).toBeGreaterThan(0);
  });
});
