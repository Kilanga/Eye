import { describe, expect, it } from 'vitest';
import { guessQuery, reconcileQuery, runQuery, sanitiseQuery } from '../src/core/ask';
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
    expect(r.sentence).toBe('$70.00 in 2 transactions.');
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

  it('keeps the words of the question over a wrong model reading', () => {
    const months = ['2026-09', '2026-10'];
    const q = 'How much did I spend on groceries each month?';
    // What Gemini Nano returned on real hardware for this question.
    const model = { intent: 'monthly_average', direction: 'out', categories: ['utilities'], month: '2026-10', text: '' } as const;
    expect(reconcileQuery({ ...model, categories: [...model.categories] }, guessQuery(q, months))).toEqual({
      intent: 'monthly_average',
      direction: 'out',
      categories: ['groceries'],
      month: '',
      text: '',
    });
    // With no keyword, the model's merchant and categories are kept.
    const free = reconcileQuery(
      { intent: 'list', direction: 'any', categories: ['subscriptions'], month: '', text: 'streamflix' },
      guessQuery('What do I pay to Streamflix?', months),
    );
    expect(free).toMatchObject({ categories: ['subscriptions'], text: 'streamflix' });
  });

  it('finds a merchant named in the question', () => {
    const labels = ['BRIGHTHOME FURNITURE PMT 3/12', 'MEGAMART #221'];
    const q = 'Show my payments to BrightHome';
    expect(guessQuery(q, [], labels)).toMatchObject({ intent: 'list', text: 'brighthome', categories: [] });
    // What Gemini Nano returned on real hardware: the "other" category and no merchant.
    expect(reconcileQuery({ intent: 'list', direction: 'out', categories: ['other'], month: '', text: '' }, guessQuery(q, [], labels))).toMatchObject({
      categories: [],
      text: 'brighthome',
    });
    expect(guessQuery('How much on groceries?', [], ['FRESH GROCERIES 12'])).toMatchObject({ categories: ['groceries'], text: '' });
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

describe('explanation paragraph from the on-device model', () => {
  it('removes the greeting, brackets and minus signs Gemini Nano added on real hardware', async () => {
    const { tidyExplanation } = await import('../src/core/interview');
    const raw = 'Dear [Lender Name],\n\nOn October 14, 2026, I received a gift of $6,000.00 from my parents. An overdraft fee of -$35.00 was charged.\n\nSincerely,\n[Your Name]';
    expect(tidyExplanation(raw)).toBe('On October 14, 2026, I received a gift of $6,000.00 from my parents. An overdraft fee of $35.00 was charged.');
    expect(tidyExplanation('A payment of -40.00 USD on October 18.')).toBe('A payment of 40.00 USD on October 18.');
  });
});

describe('underwriter questions from the cloud', () => {
  it('takes internal ids out of the question text, as Gemini wrote them in a real run', async () => {
    const { plainQuestion } = await import('../src/core/interview');
    expect(plainQuestion('Regarding check debt_ratio, can you explain the steps you are taking?')).toBe('Can you explain the steps you are taking?');
    expect(plainQuestion('What caused the large_deposits on your account?')).toBe('What caused the large deposits on your account?');
  });
});

describe('explanation check', () => {
  it('accepts dates written as words, as Gemini Nano did on real hardware', async () => {
    const { checkExplanation } = await import('../src/core/interview');
    const flagged = [{ id: 'a', accountId: 'x', date: '2026-09-05', amount: -385, currency: 'USD', country: 'US', rawLabel: 'SUMMIT AUTO LOAN PMT' }] as never;
    const answers = [{ checkId: 'debt_ratio', question: 'Debts?', answer: 'The car loan ends next year.' }] as never;
    expect(checkExplanation('I pay my car loan of 385.00 USD on September 5th.', answers, flagged)).toBe(true);
    expect(checkExplanation('I pay my car loan of 400 USD on September 5th.', answers, flagged)).toBe(false);
  });
});

describe('explanation voice', () => {
  it("rejects a paragraph written from the lender's side, as Gemini Nano wrote one on real hardware", async () => {
    const { checkExplanation } = await import('../src/core/interview');
    const answers = [{ checkId: 'large_deposits', question: 'Deposit?', answer: 'A gift from my mother.' }] as never;
    expect(checkExplanation("I've reviewed your recent account activity. The deposit was described as a gift from your mother.", answers, [])).toBe(false);
    expect(checkExplanation('The deposit was a gift from my mother for the down payment.', answers, [])).toBe(true);
  });
});

describe('explanation paragraph from the answers only', () => {
  const answers = [
    { checkId: 'overdraft' as const, question: 'What caused the recent overdraft events?', answer: 'Two small overdrafts in September when my paycheck was a day late. I now keep a $500 buffer.' },
    { checkId: 'large_deposits' as const, question: 'Where did the funds for the large deposit come from?', answer: 'My mother gave me $6,000 toward the down payment.' },
  ];

  it('keeps an amount the user wrote with a thousands separator (Gemini Nano, Nov 2026)', async () => {
    const { checkExplanation } = await import('../src/core/interview');
    const nano =
      'In September, I experienced two small overdrafts when my paycheck was a day late. I now keep a $500 buffer. The large deposit came from my mother, who gave me a gift of $6,000 towards the down payment.';
    expect(checkExplanation(nano, answers, [])).toBe(true);
    expect(checkExplanation(nano.replace('$6,000', '6000 USD'), answers, [])).toBe(true);
    expect(checkExplanation(nano.replace('$6,000', '$7,000'), answers, [])).toBe(false);
  });

  it('sends the answers to Gemini Nano, not the statement lines', async () => {
    const { explanationPrompt } = await import('../src/core/interview');
    const prompt = explanationPrompt(answers);
    expect(prompt).toContain('My mother gave me $6,000');
    expect(prompt).toContain('add none');
    expect(prompt).not.toMatch(/Flagged lines|AUTO LOAN|OVERDRAFT FEE/);
  });
});

describe('category names in the interface', () => {
  it('has a readable name for every category', async () => {
    const { CATEGORIES, CATEGORY_NAMES } = await import('../src/core/types');
    for (const c of CATEGORIES) expect(CATEGORY_NAMES[c]).toMatch(/^[A-Z]/);
  });
});
