import { describe, expect, it } from 'vitest';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { analyze } from '../src/core/analyze';
import { checkBalanceContinuity } from '../src/core/balances';
import { extractPdfLines } from '../src/core/import/pdf';
import { parseWithLayout } from '../src/core/import/statement-text';
import { getRulePack } from '../src/core/rules';
import type { Account, Transaction } from '../src/core/types';
import { DEMO_PERSONAS, usAlmostReady, usSelfEmployed } from '../src/demo/generate';
import { accountToPdf } from '../src/demo/statement-pdf';

let n = 0;
const tx = (date: string, amount: number, balance?: number): Transaction => ({
  id: `t${n++}`,
  accountId: 'a',
  date,
  amount,
  currency: 'USD',
  country: 'US',
  rawLabel: 'LINE',
  ...(balance !== undefined ? { balance } : {}),
});
const account = (transactions: Transaction[]): Account => ({ id: 'a', name: 'Checking', currency: 'USD', country: 'US', origin: 'demo', transactions });

/** Five days, one line a day, with a running balance that adds up. */
const clean = () => [
  tx('2026-10-01', 2000, 3000),
  tx('2026-10-02', -100, 2900),
  tx('2026-10-03', -50.25, 2849.75),
  tx('2026-10-04', -400, 2449.75),
  tx('2026-10-05', 25, 2474.75),
  tx('2026-10-06', -74.75, 2400),
];

describe('running balance continuity', () => {
  it('finds no break in any sample file', () => {
    for (const persona of DEMO_PERSONAS) expect(checkBalanceContinuity(persona().accounts).breaks).toEqual([]);
    // Diego's statements print a running balance: every day after the first is checked.
    expect(checkBalanceContinuity(usSelfEmployed().accounts).checkedLines).toBeGreaterThan(200);
  });

  it('points at the day after a missing line', () => {
    const lines = clean();
    lines.splice(2, 1); // the 2026-10-03 line is missing from the file
    const r = checkBalanceContinuity([account(lines)]);
    expect(r.breaks).toEqual([expect.objectContaining({ account: 'Checking', from: '2026-10-02', to: '2026-10-04' })]);
  });

  it('catches a misread amount', () => {
    const lines = clean();
    lines[3].amount = -40; // read as 40 instead of 400
    expect(checkBalanceContinuity([account(lines)]).breaks.map((b) => b.to)).toEqual(['2026-10-04']);
  });

  it('accepts lines of the same day in any order, newest first included', () => {
    const lines = [
      tx('2026-10-01', 100, 1100),
      tx('2026-10-02', -20, 1060), // printed newest first
      tx('2026-10-02', -20, 1080),
      tx('2026-10-03', 10, 1070),
      tx('2026-10-04', -5, 1065),
      tx('2026-10-05', -5, 1060),
    ];
    expect(checkBalanceContinuity([account(lines)]).breaks).toEqual([]);
  });

  it('carries days with no printed balance into the next one', () => {
    const lines = [tx('2026-10-01', 0, 1000), tx('2026-10-02', -30), tx('2026-10-03', -20, 950), tx('2026-10-04', 50, 1000)];
    expect(checkBalanceContinuity([account(lines)])).toEqual({ checkedLines: 2, breaks: [] });
  });

  it('does not flag a column that is not a running balance', () => {
    const lines = clean().map((t, i) => ({ ...t, balance: 5000 - i * 7 }));
    expect(checkBalanceContinuity([account(lines)])).toEqual({ checkedLines: 0, breaks: [] });
  });

  it('reads the balance column of a PDF statement and checks it', async () => {
    const acc = usAlmostReady().accounts[0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lines = await extractPdfLines(pdfjs as any, await accountToPdf(acc, 'Sample'));
    const read = parseWithLayout(lines, { accountId: 'pdf', currency: 'USD', country: 'US' }, 2026).transactions;
    expect(read.every((t) => t.balance !== undefined)).toBe(true);
    const fromPdf: Account = { ...account(read), name: 'Checking (PDF)' };
    expect(checkBalanceContinuity([fromPdf]).breaks).toEqual([]);
    expect(checkBalanceContinuity([fromPdf]).checkedLines).toBeGreaterThan(30);
    // A line lost between two pages, or misread, shows up.
    const lost = { ...fromPdf, transactions: read.filter((_, i) => i !== 20) };
    expect(checkBalanceContinuity([lost]).breaks).toHaveLength(1);
    // The balances now feed the funds-to-close check too.
    const pack = getRulePack('US', 'conventional');
    const funds = analyze([fromPdf], pack, { grossMonthlyIncome: 6400, projectedHousingPayment: 1850, cashToClose: 1000 }).checks.find((c) => c.id === 'funds_to_close')!;
    expect(funds.detail).toMatch(/^Balances total/);
  });

  it('turns a break into a question in the completeness check, with the lines to look at', () => {
    const persona = usSelfEmployed();
    const pack = getRulePack('US', 'bank_statement');
    const inputs = { projectedHousingPayment: persona.projectedHousingPayment, applicationDate: persona.asOf };
    const before = analyze(persona.accounts, pack, inputs).checks.find((c) => c.id === 'statement_recency')!;
    expect(before.status).toBe('ok');
    expect(before.detail).toMatch(/running balance adds up/);

    const main = persona.accounts[0];
    const sorted = main.transactions.slice().sort((a, b) => a.date.localeCompare(b.date));
    const dropped = sorted[Math.floor(sorted.length / 2)];
    main.transactions = main.transactions.filter((t) => t.date !== dropped.date);
    const after = analyze(persona.accounts, pack, inputs).checks.find((c) => c.id === 'statement_recency')!;
    expect(after.status).toBe('watch');
    expect(after.detail).toMatch(/a line or a page may be missing/);
    expect(after.transactionIds.length).toBeGreaterThan(0);
  });
});
