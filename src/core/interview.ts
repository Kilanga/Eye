import type { CheckId, CheckResult, Transaction } from './types';

/**
 * Lender interview.
 *  1. Questions: Gemini in the cloud plays the underwriter, from the summary profile only.
 *     Without a network, the default questions below are used.
 *  2. Answers: typed by the user, they never leave the device.
 *  3. Explanation paragraph: Gemini Nano writes it on the device from the answers and the
 *     flagged lines; without a model, a plain template joins the answers.
 * The paragraph fills {{explanation}} in the letter template.
 */
export interface InterviewQuestion {
  checkId: CheckId;
  question: string;
}

export const DEFAULT_QUESTIONS: Partial<Record<CheckId, string>> = {
  large_deposits: 'Where did the large deposit come from, and can you document it (gift letter, sale receipt, transfer from your own account)?',
  overdraft: 'What caused the overdraft fees, and what have you changed so it does not happen again?',
  gambling: 'Are the gambling transactions occasional entertainment, and have they stopped?',
  payday_loans: 'Why did you use short-term credit, and is it fully repaid?',
  debt_ratio: 'Is any of your current debt about to be paid off, or is your income about to change?',
  recurring_obligations: 'Is the recurring payment a loan, a lease or an instalment plan? When does it end?',
  savings_regularity: 'Do you keep savings elsewhere that these statements do not show?',
  statement_coverage: 'Are there other accounts the lender should see?',
  cash_deposits: 'Where did the cash you deposited come from?',
  statement_recency: 'Are any statements or pages missing for these accounts?',
  funds_to_close: 'Where will the rest of the money needed at closing come from (savings elsewhere, a gift, a sale)?',
};

export function defaultQuestions(checks: CheckResult[]): InterviewQuestion[] {
  return checks
    .filter((c) => c.status !== 'ok' && DEFAULT_QUESTIONS[c.id])
    .map((c) => ({ checkId: c.id, question: DEFAULT_QUESTIONS[c.id]! }));
}

/** Keeps at most 5 questions, only about checks that are actually flagged. */
export function sanitiseQuestions(raw: unknown, flagged: CheckId[]): InterviewQuestion[] {
  const list = (raw as { questions?: unknown })?.questions;
  if (!Array.isArray(list)) return [];
  return list
    .filter(
      (q): q is InterviewQuestion =>
        !!q &&
        typeof q.question === 'string' &&
        q.question.length > 5 &&
        q.question.length < 300 &&
        flagged.includes(q.checkId),
    )
    .slice(0, 5)
    .map((q) => ({ checkId: q.checkId, question: q.question.trim() }));
}

export interface Answer extends InterviewQuestion {
  answer: string;
}

/** The on-device prompt. Contains real data: it is only ever sent to Gemini Nano. */
export function explanationPrompt(answers: Answer[], flagged: Transaction[], currency: string): string {
  return [
    'Write one paragraph (at most 120 words, first person, polite, factual) for a lender, explaining the items below.',
    'Use ONLY the facts given. Do not invent dates, amounts, names or reasons. English.',
    'Flagged lines:',
    ...flagged.slice(0, 12).map((t) => `- ${t.date} ${t.rawLabel} ${t.amount.toFixed(2)} ${currency}`),
    'Applicant answers:',
    ...answers.filter((a) => a.answer.trim()).map((a) => `- ${a.question} ${a.answer.trim()}`),
  ].join('\n');
}

/** Used when no model is available: the answers, lightly framed, in the applicant's own words. */
export function templateExplanation(answers: Answer[]): string {
  const parts = answers.filter((a) => a.answer.trim()).map((a) => a.answer.trim().replace(/([^.!?])$/, '$1.'));
  return parts.length ? `I would like to explain the following points. ${parts.join(' ')}` : '';
}

/** A paragraph from the model is kept only if it does not bring numbers that are in neither the answers nor the lines. */
export function checkExplanation(text: string, answers: Answer[], flagged: Transaction[]): boolean {
  if (!text.trim() || text.length > 1200) return false;
  const known = new Set(
    [...answers.map((a) => a.answer), ...flagged.map((t) => `${t.date} ${Math.abs(t.amount)} ${Math.abs(t.amount).toFixed(2)}`)]
      .join(' ')
      .match(/\d+/g) ?? [],
  );
  const plain = text.replace(/(\d)[,\s.\u00a0\u202f](?=\d{3}\b)/g, '$1');
  return (plain.match(/\d+/g) ?? []).every((n) => known.has(n) || known.has(n.replace(/^0+(?=\d)/, '')));
}

/** Letter template used offline, with the same placeholders as the cloud one. */
export const LOCAL_LETTER_TEMPLATE = `{{date}}

To whom it may concern,

I am applying for a mortgage and would like to explain some items in my bank statements.

{{explanation}}

I can provide supporting documents on request.

Sincerely,
{{applicant_name}}`;
