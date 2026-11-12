import { CATEGORIES, type CountryCode } from '../core/types';
import type { CloudProfile } from '../core/profile';
import { LEVER_PLACEHOLDERS, type CloudStep } from '../core/plan';

export function classificationPrompt(
  labels: { i: number; label: string; amount: number }[],
  examples: { label: string; amount: number; category: string }[] = [],
): string {
  return [
    'You classify bank statement lines for a mortgage readiness check.',
    'Labels may be in English or French. A positive amount is money in, negative is money out.',
    `Allowed categories: ${CATEGORIES.join(', ')}.`,
    'confidence: "high" only if the label clearly says what it is; "low" if you are guessing.',
    'Use "other" with "low" when unsure.',
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
    'plain and short (max 30 words). Each question names the check id it is about. English.',
    'Return JSON: {"questions": [{"checkId": "...", "question": "..."}]}.',
    `Profile: ${JSON.stringify(profile)}`,
  ].join('\n');
}
