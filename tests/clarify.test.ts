import { describe, expect, it } from 'vitest';
import { applyAnswer, applyPersonalRules, fingerprint, groupKey, isUnsure, pickQuestions } from '../src/core/clarify';
import { getRulePack } from '../src/core/rules';
import type { Transaction } from '../src/core/types';
import { usAlmostReady, usSelfEmployed } from '../src/demo/generate';
import { runPipeline } from '../src/pipeline';

const tx = (over: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(36).slice(2),
  accountId: 'a',
  date: '2026-10-01',
  amount: -50,
  currency: 'USD',
  country: 'US',
  rawLabel: 'SOMETHING',
  ...over,
});

describe('which lines the app asks about', () => {
  it('asks about unrecognised and low-confidence lines only, never about lines a rule flagged', () => {
    expect(isUnsure(tx({ categorySource: 'unclassified', category: 'other' }))).toBe(true);
    expect(isUnsure(tx({ categorySource: 'on_device', category: 'groceries', categoryConfidence: 'low' }))).toBe(true);
    expect(isUnsure(tx({ categorySource: 'on_device', category: 'groceries', categoryConfidence: 'high' }))).toBe(false);
    expect(isUnsure(tx({ categorySource: 'rule', category: 'gambling' }))).toBe(false);
  });

  it('groups by merchant and puts what can change a result first', async () => {
    const p = usAlmostReady();
    const a = await runPipeline(p.accounts, getRulePack('US'), { grossMonthlyIncome: 6400, projectedHousingPayment: 1850 }, null);
    const qs = pickQuestions(p.accounts.flatMap((x) => x.transactions), a.metrics.incomeBase);
    expect(qs.length).toBeGreaterThan(0);
    expect(qs.length).toBeLessThanOrEqual(6);
    // The $6,000 deposit is the most useful question.
    expect(qs[0]).toMatchObject({ direction: 'in', exampleLabel: 'MOBILE CHECK DEPOSIT' });
    // The casino line was flagged by a rule: never asked.
    expect(qs.some((q) => /CASINO/.test(q.exampleLabel))).toBe(false);
  });
});

describe('learning from the answers, on the device', () => {
  it('applies an answer to every line of the same merchant and updates the review', async () => {
    const p = usSelfEmployed();
    const pack = getRulePack('US', 'bank_statement');
    const inputs = { projectedHousingPayment: 1650, accountKind: 'business' as const };
    const before = await runPipeline(p.accounts, pack, inputs, null);
    const all = p.accounts.flatMap((x) => x.transactions);
    const contractor = all.find((t) => t.rawLabel.startsWith('CONTRACTOR'))!;
    const changed = applyAnswer(all, groupKey(contractor), 'other');
    expect(changed).toHaveLength(12);
    expect(changed.every((t) => t.categorySource === 'user')).toBe(true);
    expect(before.sources.unclassified).toBeGreaterThan(0);
  });

  it('remembers answers as fingerprints, never as merchant names, and applies them next time', async () => {
    const key = 'out:MEGAMART ONLINE ORDER';
    const fp = await fingerprint(key);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(fp).not.toContain('MEGAMART');
    const p = usSelfEmployed();
    const a = await runPipeline(p.accounts, getRulePack('US', 'bank_statement'), { projectedHousingPayment: 1650 }, null, () => {}, {
      rules: { [fp]: 'groceries' },
    });
    expect(a.sources.user).toBe(12);
    const lines = p.accounts.flatMap((x) => x.transactions).filter((t) => t.rawLabel === 'MEGAMART ONLINE ORDER');
    expect(lines.every((t) => t.category === 'groceries' && t.categorySource === 'user')).toBe(true);
  });

  it('never applies a remembered answer over a rule', async () => {
    const t = tx({ rawLabel: 'LUCKY STAR CASINO ONLINE', amount: -40, category: 'gambling', categorySource: 'rule' });
    const n = await applyPersonalRules([t], { [await fingerprint(groupKey(t))]: 'groceries' });
    expect(n).toBe(0);
    expect(t.category).toBe('gambling');
  });

  it('gives the answers to the model as examples, only for the same kind of data', async () => {
    const seen: { origin: string; examples: unknown[] }[] = [];
    const fakeAi = {
      classifyTransactions: async (txs: Transaction[], origin: string, _p: unknown, examples: unknown[]) => {
        seen.push({ origin, examples });
        txs.forEach((t) => {
          t.category = 'other';
          t.categorySource = 'in_cloud';
          t.categoryConfidence = 'low';
        });
      },
    };
    const p = usAlmostReady();
    await runPipeline(p.accounts, getRulePack('US'), { grossMonthlyIncome: 6400, projectedHousingPayment: 1850 }, fakeAi as never, () => {}, {
      examples: [
        { label: 'CAFE LUNA 0042', amount: -6, category: 'other', origin: 'demo' },
        { label: 'REAL USER MERCHANT', amount: -6, category: 'other', origin: 'user' },
      ],
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].origin).toBe('demo');
    expect(seen[0].examples).toEqual([{ label: 'CAFE LUNA 0042', amount: -6, category: 'other', origin: 'demo' }]);
  });
});

describe('correcting lines in the full table', () => {
  const line = (over: Partial<import('../src/core/types').Transaction>) =>
    ({ id: Math.random().toString(36), accountId: 'a', date: '2026-10-01', amount: -42, currency: 'USD', country: 'US', rawLabel: 'CORNER SHOP 12', ...over }) as import('../src/core/types').Transaction;

  it('lets the user change a line a model read, and change it again later', async () => {
    const { applyAnswer, groupKey } = await import('../src/core/clarify');
    const t = line({ category: 'loan_payment', categorySource: 'on_device', categoryConfidence: 'high' });
    expect(applyAnswer([t], groupKey(t), 'groceries')).toHaveLength(1);
    expect(t).toMatchObject({ category: 'groceries', categorySource: 'user' });
    expect(applyAnswer([t], groupKey(t), 'internal_transfer')).toHaveLength(1);
    expect(t.isInternalTransfer).toBe(true);
    applyAnswer([t], groupKey(t), 'groceries');
    expect(t.isInternalTransfer).toBeUndefined();
  });

  it('never changes a line the built-in rules read', async () => {
    const { applyAnswer, groupKey, isCorrectable } = await import('../src/core/clarify');
    const t = line({ rawLabel: 'LUCKY STAR CASINO', category: 'gambling', categorySource: 'rule' });
    expect(isCorrectable(t)).toBe(false);
    expect(applyAnswer([t], groupKey(t), 'groceries')).toHaveLength(0);
    expect(t.category).toBe('gambling');
  });
});

describe('who guessed a line', () => {
  it('says the cloud guessed when the cloud stood in for Gemini Nano', async () => {
    const { pickQuestions } = await import('../src/core/clarify');
    const line = (id: string, date: string, source: 'on_device' | 'in_cloud') =>
      ({ id, accountId: 'a', date, amount: -59.47, currency: 'USD', country: 'US', rawLabel: 'MEGAMART ONLINE ORDER', category: 'groceries', categorySource: source, categoryConfidence: 'low' }) as never;
    const [cloudQ] = pickQuestions([line('1', '2026-09-19', 'in_cloud'), line('2', '2026-10-19', 'in_cloud')], 6400, 6);
    expect(cloudQ.guessBy).toBe('in_cloud');
    const [nanoQ] = pickQuestions([line('1', '2026-09-19', 'on_device'), line('2', '2026-10-19', 'on_device')], 6400, 6);
    expect(nanoQ.guessBy).toBe('on_device');
  });
});
