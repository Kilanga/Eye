import type { Category, CountryCode } from '../core/types';
import type { CloudProfile } from '../core/profile';
import { LEVER_PLACEHOLDERS, type CloudStep } from '../core/plan';

/**
 * One line per category, in general banking vocabulary (US and French). Written from what each
 * category means to a lender. Written after the first run on real hardware; words that appear in
 * the held-out lines were left out, so that set still measures how the prompt generalises.
 */
const CATEGORY_GUIDE: [Category, string][] = [
  ['income_salary', 'pay from an employer: payroll, wages, salary, direct deposit, "VIR SALAIRE", "PAIE".'],
  ['income_other', 'other money in: tax refund, interest, benefits, pension, a check or wire from someone.'],
  ['internal_transfer', 'money moved between two accounts of the same person.'],
  ['housing', 'rent, property manager, mortgage payment, condo or co-ownership fees, "LOYER".'],
  ['loan_payment', 'repayment of a loan to a lender: car, student, personal or consumer loan, "PRET".'],
  ['credit_card_payment', 'payment towards a credit card balance.'],
  ['bnpl', 'buy now pay later: a purchase split into a few instalments.'],
  ['payday_loan', 'short-term cash advance lenders: money in from them, or repayments to them.'],
  ['gambling', 'betting, gaming, lottery, poker.'],
  ['overdraft_fee', 'bank fee or interest for an overdrawn balance.'],
  ['nsf_fee', 'bank fee for a payment returned unpaid (insufficient funds).'],
  ['savings', 'money moved into a savings or investment account.'],
  ['groceries', 'supermarket, grocery store, food market.'],
  ['utilities', 'electricity, gas, water, internet, phone.'],
  ['subscriptions', 'streaming, software, gym or other monthly memberships.'],
  ['transport', 'fuel, public transport, ride share, parking, tolls.'],
  ['cash_withdrawal', 'cash taken out at a cash machine or at a till.'],
  ['cash_deposit', 'cash paid in at a branch or cash machine.'],
  ['p2p_transfer', 'payment app transfers between people.'],
  ['refund', 'a merchant giving money back for a return or a cancelled purchase.'],
  ['other', 'everyday spending that is none of the above: shops, restaurants, health, school, childcare.'],
];

export function classificationPrompt(
  labels: { i: number; label: string; amount: number }[],
  examples: { label: string; amount: number; category: string }[] = [],
): string {
  return [
    'You classify bank statement lines for a mortgage readiness check.',
    'Labels may be in English or French. A positive amount is money in, negative is money out.',
    'Categories (what a lender means by each):',
    ...CATEGORY_GUIDE.map(([c, d]) => `- ${c}: ${d}`),
    'A payment that could be a debt (rent, any loan, instalments, an advance) is never "other": pick the closest debt category, with "low" if unsure.',
    'confidence: "high" only if the label clearly says what it is; "low" if you are guessing.',
    'Use "other" with "low" when you cannot tell.',
    ...(examples.length
      ? ['The account holder has already told us what these lines are; follow them for similar lines:', ...examples.slice(0, 12).map((e) => `${e.amount.toFixed(2)}\t${e.label}\t=> ${e.category}`)]
      : []),
    'Answer with JSON only: {"items":[{"i":<index>,"category":"<category>","confidence":"high|low"}]}.',
    '',
    ...labels.map((l) => `${l.i}\t${l.amount.toFixed(2)}\t${l.label}`),
  ].join('\n');
}

export function planPrompt(profile: CloudProfile, steps: CloudStep[]): string {
  return [
    'You are a plain-spoken coach helping someone prepare a mortgage or rental application.',
    `Country rules: ${profile.country}. You only see a summary profile, never statements.`,
    'The steps of a 90-day plan are already decided by code. Your job is the wording only.',
    'For each step i, write "action" (what to do, max 25 words) and "why" (the lender\'s view, max 25 words).',
    'NEVER write a digit. Every figure must be a placeholder in double curly braces, chosen ONLY from that step\'s list.',
    'Also write a "summary" of at most 2 sentences, with no digits and no placeholders.',
    'No investment advice, no lender or product names. English.',
    'Return JSON: {"summary": "...", "steps": [{"i": 0, "action": "...", "why": "..."}]}.',
    '',
    `Profile: ${JSON.stringify(profile)}`,
    'Steps:',
    ...steps.map(
      (s, i) => `${i}\tweek ${s.week}\t${s.checkId}\t${s.lever}\tplaceholders: ${LEVER_PLACEHOLDERS[s.lever].map((p) => `{{${p}}}`).join(' ')}`,
    ),
  ].join('\n');
}

export function letterPrompt(country: CountryCode, flags: string[]): string {
  const kind = country === 'US' ? 'a letter of explanation for a mortgage underwriter' : 'a short explanation note for a French bank';
  return [
    `Write ${kind}, in English, covering these items: ${flags.join(', ')}.`,
    'Use ONLY placeholders in double curly braces for every personal detail, for example',
    '{{applicant_name}}, {{date}}, {{deposit_amount}}, {{deposit_date}}, {{deposit_source}}. It MUST contain {{explanation}} once,',
    'where the applicant\'s own explanation paragraph will be inserted on their device.',
    'Never invent names, amounts or dates. Keep it under 180 words, polite and factual.',
    'Return JSON: {"template": "...", "placeholders": ["..."]}.',
  ].join('\n');
}

export function interviewPrompt(profile: CloudProfile, flagged: string[]): string {
  return [
    'You are a mortgage underwriter reviewing an application. You only see this summary, never the statements.',
    `Country rules: ${profile.country}. Flagged checks: ${flagged.join(', ')}.`,
    'Ask the 3 to 5 questions you would really ask the applicant about the flagged checks, one per check at most,',
    'plain and short (max 30 words), in everyday words. Put the check id in the checkId field only, never in the question text. English.',
    'Return JSON: {"questions": [{"checkId": "...", "question": "..."}]}.',
    `Profile: ${JSON.stringify(profile)}`,
  ].join('\n');
}
