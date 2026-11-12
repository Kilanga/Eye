import { CATEGORIES, type CountryCode } from '../core/types';
import type { CloudProfile } from '../core/profile';

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

export function planPrompt(profile: CloudProfile): string {
  return [
    'You are a plain-spoken coach helping someone prepare a mortgage application.',
    `Country rules: ${profile.country}. You only see a summary profile, never statements.`,
    'Write a 90-day plan (weeks 1 to 12) with at most 8 concrete actions, each tied to one check id.',
    'Focus on checks with status "watch" or "alert". Do not give investment advice or recommend a lender.',
    'Answer in English. Profile:',
    JSON.stringify(profile),
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
