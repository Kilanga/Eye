import { describe, expect, it } from 'vitest';
import { documentsFor, GIFT_LETTER_TEMPLATE } from '../src/core/documents';
import { fillTemplate } from '../src/core/letter';
import { buildDraftPlan } from '../src/core/plan';
import { getRulePack } from '../src/core/rules';
import type { Account } from '../src/core/types';
import { usAlmostReady, usSelfEmployed } from '../src/demo/generate';
import { runPipeline } from '../src/pipeline';

const status = (a: { checks: { id: string; status: string }[] }, id: string) => a.checks.find((c) => c.id === id)?.status;

describe('bank statement loan (self-employed)', () => {
  it('computes income from eligible deposits, net of the 50% expense ratio', async () => {
    const p = usSelfEmployed();
    const pack = getRulePack('US', 'bank_statement');
    const inputs = { projectedHousingPayment: 1650, accountKind: 'business' as const, cashToClose: 30000, applicationDate: p.asOf };
    const a = await runPipeline(p.accounts, pack, inputs, null);
    // Client payments + cash deposits count; owner draws, the refund and the Zelle from a person do not.
    expect(a.metrics.eligibleDepositsMonthly).toBeGreaterThan(4000);
    expect(a.metrics.eligibleDepositsMonthly).toBeLessThan(5200);
    expect(a.metrics.incomeBase).toBe(a.metrics.eligibleDepositsMonthly);
    expect(status(a, 'debt_ratio')).toBe('watch');
    expect(status(a, 'cash_deposits')).toBe('watch');
    expect(status(a, 'funds_to_close')).toBe('ok');
    expect(a.obligations).toEqual([expect.objectContaining({ kind: 'person', monthlyAmount: 300, counted: false })]);
  });

  it('uses 100% of deposits for a personal account', async () => {
    const p = usSelfEmployed();
    const pack = getRulePack('US', 'bank_statement');
    const biz = await runPipeline(p.accounts, pack, { projectedHousingPayment: 1650, accountKind: 'business' }, null);
    const personal = await runPipeline(usSelfEmployed().accounts, pack, { projectedHousingPayment: 1650, accountKind: 'personal' }, null);
    expect(personal.metrics.incomeBase).toBeCloseTo(biz.metrics.incomeBase * 2, 0);
  });

  it('asks for a CPA letter and proof of business in the checklist', async () => {
    const p = usSelfEmployed();
    const a = await runPipeline(p.accounts, getRulePack('US', 'bank_statement'), { projectedHousingPayment: 1650 }, null);
    const docs = documentsFor(a.checks, 'bank_statement').map((d) => d.text).join(' ');
    expect(docs).toContain('CPA');
    expect(docs).toContain('cash deposit');
  });
});

describe('FHA and VA notes', () => {
  it('adds the FHA note on overdrafts and the VA note on the ratio', async () => {
    const inputs = { grossMonthlyIncome: 6400, projectedHousingPayment: 1850 };
    const fha = await runPipeline(usAlmostReady().accounts, getRulePack('US', 'fha'), inputs, null);
    expect(fha.checks.find((c) => c.id === 'overdraft')?.detail).toContain('manual underwriting');
    // 38.2% is comfortable under FHA's 43%.
    expect(status(fha, 'debt_ratio')).toBe('ok');
    const va = await runPipeline(usAlmostReady().accounts, getRulePack('US', 'va'), { ...inputs, projectedHousingPayment: 2200 }, null);
    expect(va.checks.find((c) => c.id === 'debt_ratio')?.detail).toContain('residual income');
  });
});

describe('recent and complete statements, funds to close', () => {
  const acc = (dates: string[], balance?: number): Account => ({
    id: 'x',
    name: 'Checking',
    currency: 'USD',
    country: 'US',
    origin: 'demo',
    transactions: dates.map((date, i) => ({ id: `x${i}`, accountId: 'x', date, amount: -10, currency: 'USD', country: 'US', rawLabel: 'CORNER SHOP', balance })),
  });

  it('flags statements older than 45 days and missing months', async () => {
    const pack = getRulePack('US');
    const old = await runPipeline([acc(['2026-07-03', '2026-08-20'])], pack, { projectedHousingPayment: 1000, applicationDate: '2026-11-12' }, null);
    expect(status(old, 'statement_recency')).toBe('alert');
    const gap = await runPipeline([acc(['2026-07-03', '2026-09-20', '2026-10-30'])], pack, { projectedHousingPayment: 1000, applicationDate: '2026-11-02' }, null);
    expect(status(gap, 'statement_recency')).toBe('watch');
  });

  it('checks funds only when the cash needed is given', async () => {
    const pack = getRulePack('US');
    const none = await runPipeline([acc(['2026-10-30'], 5000)], pack, { projectedHousingPayment: 1000 }, null);
    expect(none.checks.some((c) => c.id === 'funds_to_close')).toBe(false);
    const short = await runPipeline([acc(['2026-10-30'], 5000)], pack, { projectedHousingPayment: 1000, cashToClose: 20000 }, null);
    expect(status(short, 'funds_to_close')).toBe('alert');
    const plan = buildDraftPlan(short, pack, { projectedHousingPayment: 1000, cashToClose: 20000 });
    expect(plan.steps.find((s) => s.lever === 'build_funds')?.values.funds_gap).toBe('$15,000');
  });
});

describe('gift letter', () => {
  it('is filled on the device and states that no repayment is expected', () => {
    const r = fillTemplate(GIFT_LETTER_TEMPLATE, { donor_name: 'Ana', gift_amount: '$6,000.00' });
    expect(r.text).toContain('Ana');
    expect(r.text).toContain('No repayment is expected');
    expect(r.missing).toContain('relationship');
  });
});
