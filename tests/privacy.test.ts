import { describe, expect, it } from 'vitest';
import { assertSafeForCloud, OutboundLedger, PrivacyViolation } from '../src/core/ledger';
import { getRulePack } from '../src/core/rules';
import { buildCloudProfile } from '../src/core/profile';
import { usAlmostReady } from '../src/demo/generate';
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
