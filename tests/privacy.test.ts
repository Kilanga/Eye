import { describe, expect, it } from 'vitest';
import { assertSafeForCloud, OutboundLedger, PrivacyViolation } from '../src/core/ledger';
import { getRulePack } from '../src/core/rules';
import { buildCloudProfile } from '../src/core/profile';
import { DEMO_PERSONAS, usAlmostReady } from '../src/demo/generate';
import { runPipeline } from '../src/pipeline';

async function profileAndLabels() {
  const p = usAlmostReady();
  const a = await runPipeline(p.accounts, getRulePack('US'), { grossMonthlyIncome: 6400, projectedHousingPayment: 1850 }, null);
  return { profile: buildCloudProfile(a, 1850), labels: p.accounts.flatMap((x) => x.transactions.map((t) => t.rawLabel)) };
}

describe('assertSafeForCloud', () => {
  it('accepts the real profile built from statements', async () => {
    const { profile, labels } = await profileAndLabels();
    expect(() => assertSafeForCloud(profile, labels)).not.toThrow();
  });

  it('rejects a payload containing a raw statement label', async () => {
    const { profile, labels } = await profileAndLabels();
    const leaked = { ...profile, country: 'BRIGHTWAVE LABS PAYROLL' };
    expect(() => assertSafeForCloud(leaked, labels)).toThrow(PrivacyViolation);
  });

  it('rejects unknown keys and free text', async () => {
    const { profile, labels } = await profileAndLabels();
    expect(() => assertSafeForCloud({ ...profile, note: 1 }, labels)).toThrow(PrivacyViolation);
    expect(() => assertSafeForCloud({ ...profile, country: 'Austin TX' }, [])).toThrow(PrivacyViolation);
    expect(() => assertSafeForCloud({ ...profile, checks: [{ id: 'gambling', status: 'ok', label: 'x' }] }, [])).toThrow(
      PrivacyViolation,
    );
  });
});

describe('assertSafeForCloud: rounded numbers only', () => {
  it('refuses an exact amount, a decimal or a number that is not a whole bucket', async () => {
    const { profile, labels } = await profileAndLabels();
    expect(() => assertSafeForCloud({ ...profile, incomeBucket: 6412 }, labels)).toThrow(PrivacyViolation);
    expect(() => assertSafeForCloud({ ...profile, housingPaymentBucket: 1849.99 }, labels)).toThrow(PrivacyViolation);
    expect(() => assertSafeForCloud({ ...profile, housingPaymentBucket: 1850 }, labels)).toThrow(PrivacyViolation);
    expect(() => assertSafeForCloud({ ...profile, debtRatioPct: 41.7 }, labels)).toThrow(PrivacyViolation);
    expect(() => assertSafeForCloud({ ...profile, monthsCovered: Number.NaN }, labels)).toThrow(PrivacyViolation);
    expect(() => assertSafeForCloud({ ...profile, debtRatioPct: Infinity }, labels)).toThrow(PrivacyViolation);
  });

  it('accepts the profile of every sample file, with any housing payment', async () => {
    for (const persona of DEMO_PERSONAS) {
      const p = persona();
      const pack = getRulePack(p.country, p.program);
      for (const housing of [0, 1849.99, p.projectedHousingPayment]) {
        const a = await runPipeline(p.accounts, pack, { grossMonthlyIncome: p.grossMonthlyIncome, projectedHousingPayment: housing }, null);
        expect(() => assertSafeForCloud(buildCloudProfile(a, housing), [])).not.toThrow();
      }
    }
  });

  it('still accepts "not computable" (-1) and whole buckets', async () => {
    const { profile, labels } = await profileAndLabels();
    expect(() => assertSafeForCloud({ ...profile, debtRatioPct: -1, incomeBucket: 6000, housingPaymentBucket: 1750 }, labels)).not.toThrow();
  });
});

describe('OutboundLedger', () => {
  it('records the exact payload and its size', () => {
    const ledger = new OutboundLedger();
    let calls = 0;
    ledger.onChange(() => calls++);
    const e = ledger.record('plan', { a: 1 });
    ledger.setSource(e, 'in_cloud');
    expect(ledger.list()[0].payload).toBe('{"a":1}');
    expect(ledger.list()[0].bytes).toBe(7);
    expect(ledger.list()[0].inferenceSource).toBe('in_cloud');
    expect(calls).toBeGreaterThan(0);
  });
});
