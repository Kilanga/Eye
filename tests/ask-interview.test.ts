import { describe, expect, it } from 'vitest';
import { guessQuery, runQuery, sanitiseQuery } from '../src/core/ask';
import { checkExplanation, defaultQuestions, sanitiseQuestions, templateExplanation } from '../src/core/interview';
import { getRulePack } from '../src/core/rules';
import { usAlmostReady } from '../src/demo/generate';
import { runPipeline } from '../src/pipeline';

async function maya() {
  const p = usAlmostReady();
  const a = await runPipeline(p.accounts, getRulePack('US'), { grossMonthlyIncome: 6400, projectedHousingPayment: 1850 }, null);
  return { a, txs: p.accounts.flatMap((x) => x.transactions) };
}

describe('ask your statements', () => {
  it('computes answers in code from a structured query', async () => {
    const { txs } = await maya();
    const r = runQuery(
      { intent: 'total', direction: 'out', categories: ['overdraft_fee', 'nsf_fee'], month: '', text: '' },
      txs,
      'USD',
      'en-US',
    );
    expect(r.sentence).toBe('$70.00 in 2 transaction(s).');
    const largest = runQuery({ intent: 'largest', direction: 'in', categories: [], month: '2026-10', text: '' }, txs, 'USD', 'en-US');
    expect(largest.sentence).toContain('$6,000.00');
  });

  it('rejects anything outside the query schema', () => {
    expect(sanitiseQuery({ intent: 'delete_all' }, [])).toBeNull();
    expect(sanitiseQuery({ intent: 'total', direction: 'x', categories: ['groceries', 'nope'], month: '1999-01', text: 'A<b>' }, ['2026-10'])).toEqual({
      intent: 'total',
      direction: 'any',
      categories: ['groceries'],
      month: '',
      text: 'ab',
    });
  });

  it('has a keyword fallback for the obvious questions', () => {
    expect(guessQuery('How much did I spend on groceries in October?', ['2026-09', '2026-10'])).toMatchObject({
      intent: 'total',
      direction: 'out',
      categories: ['groceries'],
      month: '2026-10',
    });
    expect(guessQuery('Combien de fois des frais de découvert ?', [])).toMatchObject({ intent: 'count', categories: ['overdraft_fee', 'nsf_fee'] });
  });
});

describe('lender interview', () => {
  it('asks only about flagged checks, and keeps the model to 5 questions', async () => {
    const { a } = await maya();
    const ids = defaultQuestions(a.checks).map((q) => q.checkId);
    expect(ids).toEqual(expect.arrayContaining(['large_deposits', 'overdraft', 'debt_ratio']));
    expect(ids).not.toContain('payday_loans');
    const many = { questions: Array.from({ length: 9 }, () => ({ checkId: 'overdraft', question: 'Why the fees?' })) };
    expect(sanitiseQuestions(many, ['overdraft'])).toHaveLength(5);
    expect(sanitiseQuestions({ questions: [{ checkId: 'payday_loans', question: 'Why the loan?' }] }, ['overdraft'])).toHaveLength(0);
  });

  it('rejects an explanation that brings numbers from nowhere', async () => {
    const { txs } = await maya();
    const deposit = txs.filter((t) => t.amount === 6000);
    const answers = [{ checkId: 'large_deposits' as const, question: 'Where from?', answer: 'A gift from my aunt for the down payment.' }];
    expect(checkExplanation('The $6,000 deposit on 2026-10-14 was a gift from my aunt.', answers, deposit)).toBe(true);
    expect(checkExplanation('The $9,500 deposit was a gift.', answers, deposit)).toBe(false);
    expect(templateExplanation(answers)).toContain('A gift from my aunt');
  });
});
