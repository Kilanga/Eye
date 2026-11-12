import type { Category } from './types';

/** Categories that only make sense for money coming in. */
const IN_ONLY: ReadonlySet<Category> = new Set(['income_salary', 'income_other', 'refund', 'cash_deposit']);
/** Categories that only make sense for money going out. */
const OUT_ONLY: ReadonlySet<Category> = new Set([
  'housing',
  'loan_payment',
  'credit_card_payment',
  'bnpl',
  'groceries',
  'utilities',
  'subscriptions',
  'transport',
  'cash_withdrawal',
  'overdraft_fee',
  'nsf_fee',
  'savings',
]);

/**
 * Whether a category is possible for a line with this sign. A model answer that fails this
 * check (a restaurant bill read as income, a deposit read as rent) is not kept: the line is
 * marked unsure and becomes a question for the user.
 */
export function fitsDirection(category: Category, amount: number): boolean {
  if (amount < 0) return !IN_ONLY.has(category);
  if (amount > 0) return !OUT_ONLY.has(category);
  return true;
}
