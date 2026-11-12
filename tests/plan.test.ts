import { describe, expect, it } from 'vitest';
import { compareSnapshots, takeSnapshot } from '../src/core/followup';
import { assertSafeForCloud } from '../src/core/ledger';
import { buildDraftPlan, finalisePlan, isValidWording, toCloudSteps } from '../src/core/plan';
import { buildCloudProfile } from '../src/core/profile';
import { getRulePack } from '../src/core/rules';
import { frClean, usAlmostReady, usFollowUp30, usFollowUp60, type DemoPersona } from '../src/demo/generate';
import { runPipeline } from '../src/pipeline';

async function run(p: DemoPersona) {
  const pack = getRulePack(p.country);
  const inputs = { grossMonthlyIncome: p.grossMonthlyIncome, projectedHousingPayment: p.projectedHousingPayment };
  const analysis = await runPipeline(p.accounts, pack, inputs, null);
  const profile = buildCloudProfile(analysis, p.projectedHousingPayment);
  return { pack, inputs, analysis, profile, draft: buildDraftPlan(analysis, pack, inputs) };
}

describe('local 90-day plan', () => {
  it('computes the exact lever figures for Maya', async () => {
    const { draft } = await run(usAlmostReady());
    const debt = draft.steps.find((s) => s.lever === 'reduce_debt_payments')!;
    // (385 + 210 + 1850) / 6400 = 38.2%; 36% of 6400 = 2304 -> 141 less, housing up to 1709.
    expect(debt.values.current_ratio).toBe('38.2%');
    expect(debt.values.monthly_reduction).toBe('$141');
    expect(debt.values.max_housing_payment).toBe('$1,709');
    expect(draft.steps.map((s) => s.lever)).toEqual(
      expect.arrayContaining(['overdraft_buffer', 'document_deposits', 'stop_gambling', 'reduce_debt_payments']),
    );
    expect(draft.steps[0].status).toBe('alert'); // the red light comes first
    expect(draft.cleanFromWeek).toBe(5); // US: the last 2 months are read
  });

  it('has no step when every light is green', async () => {
    const { draft } = await run(frClean());
    expect(draft.steps).toHaveLength(0);
    expect(finalisePlan(draft).summary).toMatch(/green/);
  });

  it('works offline with local wording and real figures', async () => {
    const plan = finalisePlan((await run(usAlmostReady())).draft);
    expect(plan.steps.every((s) => s.wording === 'local')).toBe(true);
    expect(plan.steps.some((s) => s.action.includes('$141'))).toBe(true);
    expect(plan.steps.every((s) => !s.action.includes('{{'))).toBe(true);
  });

  it('keeps cloud wording only when it writes no number and uses its own placeholders', async () => {
    const { draft } = await run(usAlmostReady());
    const i = draft.steps.findIndex((s) => s.lever === 'reduce_debt_payments');
    const good = finalisePlan(draft, {
      summary: 'You are close. Clear the red light first.',
      steps: [{ i, action: 'Trim {{monthly_reduction}} a month from loans.', why: 'That brings you to {{target_ratio}}.' }],
    });
    expect(good.steps[i].wording).toBe('cloud');
    expect(good.steps[i].action).toBe('Trim $141 a month from loans.');
    expect(good.summaryWording).toBe('cloud');

    const invented = finalisePlan(draft, { steps: [{ i, action: 'Pay $200 less each month.', why: 'Reach 36%.' }] });
    expect(invented.steps[i].wording).toBe('local');
    const wrongPlaceholder = finalisePlan(draft, { steps: [{ i, action: 'Stop {{gambling_monthly}}.', why: 'Because.' }] });
    expect(wrongPlaceholder.steps[i].wording).toBe('local');
    expect(isValidWording('Five steps', [])).toBe(true);
    expect(isValidWording('5 steps', [])).toBe(false);
  });

  it('sends only enums for the steps', async () => {
    const { draft, profile } = await run(usAlmostReady());
    const labels = usAlmostReady().accounts.flatMap((a) => a.transactions.map((t) => t.rawLabel));
    const payload = { ...profile, steps: toCloudSteps(draft) };
    expect(() => assertSafeForCloud(payload, labels)).not.toThrow();
    expect(JSON.stringify(payload)).not.toContain('141');
    expect(() => assertSafeForCloud({ ...profile, steps: [{ ...toCloudSteps(draft)[0], values: 1 }] }, labels)).toThrow();
  });
});

describe('follow-up scans', () => {
  it('shows Maya improving at day 30 and all green at day 60', async () => {
    const base = await run(usAlmostReady());
    const d30 = await run(usFollowUp30());
    const d60 = await run(usFollowUp60());
    const s0 = takeSnapshot(base.profile, new Date('2026-10-31T12:00:00Z'));
    const s30 = takeSnapshot(d30.profile, new Date('2026-11-30T12:00:00Z'));
    const s60 = takeSnapshot(d60.profile, new Date('2026-12-31T12:00:00Z'));

    const c30 = compareSnapshots(s0, s30)!;
    expect(c30.daysBetween).toBe(30);
    expect(c30.worsened).toBe(0);
    expect(c30.checks.find((c) => c.id === 'overdraft')).toMatchObject({ before: 'alert', after: 'watch', trend: 'better' });
    expect(c30.checks.find((c) => c.id === 'debt_ratio')).toMatchObject({ before: 'watch', after: 'ok' });

    const c60 = compareSnapshots(s0, s60)!;
    expect(c60.checks.every((c) => c.after === 'ok')).toBe(true);
    expect(d60.draft.steps).toHaveLength(0);
  });

  it('does not compare different countries', async () => {
    const us = takeSnapshot((await run(usAlmostReady())).profile);
    const fr = takeSnapshot((await run(frClean())).profile);
    expect(compareSnapshots(us, fr)).toBeNull();
  });
});
