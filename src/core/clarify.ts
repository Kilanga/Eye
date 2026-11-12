import { normaliseLabel } from './recurring';
import type { Category, Transaction } from './types';

/**
 * Ask the user about the lines the app could not read with confidence, and learn from the
 * answers. Everything stays on the device:
 *
 *  - Questions: lines the rules did not recognise, or that Gemini Nano classified with low
 *    confidence, grouped by merchant, and only the groups that could change a result.
 *  - Learning, level 1: personal rules. The merchant is remembered as a SHA-256 fingerprint of
 *    its normalised name (and direction), never as text, and only if the user opts in.
 *  - Learning, level 2: the answers become few-shot examples in the on-device prompt, for
 *    similar lines (another contractor, another client). Kept in memory for the session.
 *
 * Answers only ever apply to lines the app was unsure about: a line the rules already flag
 * (gambling, payday loan, overdraft fee) cannot be renamed away. The lender sees the real line.
 */

export interface Choice {
  category: Category;
  label: string;
}

/** Plain-language answers, by direction of the money. */
export const CHOICES_IN: Choice[] = [
  { category: 'income_other', label: 'Income from work or my business' },
  { category: 'income_salary', label: 'Salary' },
  { category: 'refund', label: 'A refund' },
  { category: 'p2p_transfer', label: 'Money from a person' },
  { category: 'internal_transfer', label: 'From another account of mine' },
  { category: 'cash_deposit', label: 'Cash I deposited' },
  { category: 'other', label: 'Something else' },
];
export const CHOICES_OUT: Choice[] = [
  { category: 'loan_payment', label: 'A loan or instalment payment' },
  { category: 'housing', label: 'Rent or housing' },
  { category: 'utilities', label: 'A bill or subscription' },
  { category: 'groceries', label: 'Everyday spending' },
  { category: 'p2p_transfer', label: 'Payment to a person' },
  { category: 'internal_transfer', label: 'To another account of mine' },
  { category: 'gambling', label: 'Betting or casino' },
  { category: 'other', label: 'A business cost, or something else' },
];

export interface Question {
  key: string;
  direction: 'in' | 'out';
  exampleLabel: string;
  transactionIds: string[];
  count: number;
  months: number;
  total: number;
  /** Why it matters to the lender, in plain words. */
  reason: string;
  /** What the model guessed, if anything. */
  guess?: Category;
}

/** A line the app is unsure about: not recognised, or a low-confidence model answer. */
export function isUnsure(t: Transaction): boolean {
  if (t.isInternalTransfer || t.categorySource === 'rule' || t.categorySource === 'user') return false;
  // A model that answers "other" could not tell: worth a question, since a missed debt changes the ratio.
  const modelOther = (t.categorySource === 'on_device' || t.categorySource === 'in_cloud') && t.category === 'other';
  return t.categorySource === 'unclassified' || t.categoryConfidence === 'low' || !t.category || modelOther;
}

export function groupKey(t: Transaction): string {
  return `${t.amount >= 0 ? 'in' : 'out'}:${normaliseLabel(t.rawLabel)}`;
}

/**
 * Picks the questions worth asking, most useful first: money in that could be income or a
 * large deposit, regular payments that could be debt, then large amounts.
 */
export function pickQuestions(transactions: Transaction[], monthlyIncome: number, max = 6): Question[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (!isUnsure(t)) continue;
    const k = groupKey(t);
    if (!k.split(':')[1]) continue;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const scored = [...groups.entries()].map(([key, txs]) => {
    const direction: 'in' | 'out' = txs[0].amount >= 0 ? 'in' : 'out';
    const total = txs.reduce((s, t) => s + Math.abs(t.amount), 0);
    const months = new Set(txs.map((t) => t.date.slice(0, 7))).size;
    const biggest = Math.max(...txs.map((t) => Math.abs(t.amount)));
    let score = total;
    let reason = 'A large amount the app could not read.';
    if (direction === 'in' && monthlyIncome > 0 && biggest > 0.5 * monthlyIncome) {
      score *= 4;
      reason = 'A large deposit: if it is not income, the lender will ask where it came from.';
    } else if (direction === 'in') {
      score *= 2;
      reason = 'Money in: it may count as income, or need explaining.';
    } else if (months >= 2) {
      score *= 3;
      reason = 'A regular payment: the lender will want to know if it is a debt.';
    }
    const guesses = txs.map((t) => t.category).filter((c): c is Category => !!c && c !== 'other');
    return {
      key,
      direction,
      exampleLabel: txs[0].rawLabel,
      transactionIds: txs.map((t) => t.id),
      count: txs.length,
      months,
      total: Math.round(total * 100) / 100,
      reason,
      ...(guesses[0] ? { guess: guesses[0] } : {}),
      score,
    };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(({ score: _score, ...q }) => q);
}

/** Applies an answer to every unsure line of the same merchant and direction. Returns the lines changed. */
export function applyAnswer(transactions: Transaction[], key: string, category: Category): Transaction[] {
  const changed = transactions.filter((t) => isUnsure(t) && groupKey(t) === key);
  changed.forEach((t) => {
    t.category = category;
    t.categorySource = 'user';
    t.categoryConfidence = 'high';
    if (category === 'internal_transfer') t.isInternalTransfer = true;
  });
  return changed;
}

// ------------------------------------------------------------------ personal rules (fingerprints)

export type PersonalRules = Record<string, Category>;

/** SHA-256 of the merchant key: lets the app recognise the merchant again without storing its name. */
export async function fingerprint(key: string): Promise<string> {
  const bytes = new TextEncoder().encode(`underwriters-eye:${key}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Applies remembered answers to lines the rules did not recognise. Returns how many lines it set. */
export async function applyPersonalRules(transactions: Transaction[], rules: PersonalRules): Promise<number> {
  if (!Object.keys(rules).length) return 0;
  let n = 0;
  for (const t of transactions) {
    if (t.category || t.isInternalTransfer) continue;
    const c = rules[await fingerprint(groupKey(t))];
    if (c) {
      t.category = c;
      t.categorySource = 'user';
      t.categoryConfidence = 'high';
      if (c === 'internal_transfer') t.isInternalTransfer = true;
      n++;
    }
  }
  return n;
}

const STORE = 'underwriters-eye.personal-rules';

export function loadPersonalRules(): PersonalRules {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(STORE) ?? '{}') as PersonalRules;
  } catch {
    return {};
  }
}

export function savePersonalRules(rules: PersonalRules): void {
  try {
    globalThis.localStorage?.setItem(STORE, JSON.stringify(rules));
  } catch {
    /* storage unavailable: the answers still apply for this session */
  }
}

export function clearPersonalRules(): void {
  try {
    globalThis.localStorage?.removeItem(STORE);
  } catch {
    /* ignore */
  }
}
