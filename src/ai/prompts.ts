import { CATEGORIES, type CountryCode } from '../core/types';
import type { CloudProfile } from '../core/profile';
import { LEVER_PLACEHOLDERS, type CloudStep } from '../core/plan';

export function classificationPrompt(labels: { i: number; label: string; amount: number }[]): string {
  return [
    'You classify bank statement lines for a mortgage readiness check.',
    'Labels may be in English or French. A positive amount is money in, negative is money out.',
    `Allowed categories: ${CATEGORIES.join(', ')}.`,
    'Use "other" when unsure. Answer with JSON only: {"items":[{"i":<index>,"category":"<category>"}]}.',
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
    '{{applicant_name}}, {{deposit_amount}}, {{deposit_date}}, {{deposit_source}}, {{overdraft_dates}}, {{explanation}}.',
    'Never invent names, amounts or dates. Keep it under 180 words, polite and factual.',
    'Return JSON: {"template": "...", "placeholders": ["..."]}.',
  ].join('\n');
}
