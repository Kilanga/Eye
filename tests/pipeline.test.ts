import { describe, expect, it } from 'vitest';
import { getRulePack } from '../src/core/rules';
import { buildCloudProfile, PROFILE_KEYS } from '../src/core/profile';
import { frClean, usAlmostReady } from '../src/demo/generate';
import { runPipeline } from '../src/pipeline';

const statusOf = (a: Awaited<ReturnType<typeof runPipeline>>, id: string) => a.checks.find((c) => c.id === id)?.status;

describe('US persona "almost ready"', () => {
  it('flags DTI, overdrafts, large deposit and gambling, keyword rules only', async () => {
    const p = usAlmostReady();
    const a = await runPipeline(p.accounts, getRulePack('US'), {
      grossMonthlyIncome: p.grossMonthlyIncome,
      projectedHousingPayment: p.projectedHousingPayment,
    }, null);
    expect(a.metrics.debtRatio).toBeGreaterThan(0.36);
    expect(a.metrics.debtRatio).toBeLessThan(0.43);
    expect(statusOf(a, 'debt_ratio')).toBe('watch');
    expect(a.metrics.overdraftFeeCount).toBe(2);
    expect(statusOf(a, 'overdraft')).toBe('alert');
    expect(a.metrics.largeDepositCount).toBe(1);
    expect(statusOf(a, 'large_deposits')).toBe('watch');
    expect(a.metrics.gamblingCount).toBeGreaterThan(0);
    expect(statusOf(a, 'payday_loans')).toBe('ok');
  });

  it('never counts internal transfers as income', async () => {
    const p = usAlmostReady();
    const a = await runPipeline(p.accounts, getRulePack('US'), { grossMonthlyIncome: 6400, projectedHousingPayment: 1850 }, null);
    const internal = p.accounts.flatMap((acc) => acc.transactions).filter((t) => t.isInternalTransfer);
    expect(internal.length).toBeGreaterThan(0);
    expect(internal.every((t) => t.category === 'internal_transfer')).toBe(true);
    expect(a.metrics.monthlySalary).toBeCloseTo(4900, 0);
  });
});

describe('FR persona "clean"', () => {
  it('passes the 35% taux d\'effort and shows regular savings', async () => {
    const p = frClean();
    const a = await runPipeline(p.accounts, getRulePack('FR'), { projectedHousingPayment: p.projectedHousingPayment }, null);
    expect(a.metrics.debtRatio).toBeLessThanOrEqual(0.35);
    expect(statusOf(a, 'debt_ratio')).toBe('ok');
    expect(statusOf(a, 'overdraft')).toBe('ok');
    expect(a.metrics.savingsMonths).toBeGreaterThanOrEqual(3);
    expect(statusOf(a, 'savings_regularity')).toBe('ok');
  });
});

describe('cloud profile', () => {
  it('contains only whitelisted keys and bucketed amounts', async () => {
    const p = usAlmostReady();
    const a = await runPipeline(p.accounts, getRulePack('US'), { grossMonthlyIncome: 6400, projectedHousingPayment: 1850 }, null);
    const profile = buildCloudProfile(a, 1850);
    expect(Object.keys(profile).sort()).toEqual([...PROFILE_KEYS].sort());
    expect(profile.incomeBucket % 500).toBe(0);
    expect(profile.housingPaymentBucket % 250).toBe(0);
  });
});

describe('model failure', () => {
  it('keeps the analysis going with the rules when the model throws', async () => {
    const p = usAlmostReady();
    const failing = { classifyTransactions: async () => { throw new Error('network down'); } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = await runPipeline(p.accounts, getRulePack('US'), { grossMonthlyIncome: 6400, projectedHousingPayment: 1850 }, failing as any);
    expect(a.checks.length).toBeGreaterThan(0);
    expect(a.notes.join(' ')).toContain('network down');
    expect(a.sources.unclassified).toBeGreaterThan(0);
  });
});
