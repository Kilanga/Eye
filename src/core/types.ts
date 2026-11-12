/** Countries with a rule pack. Adding a country = adding a file in src/core/rules/. */
export type CountryCode = 'US' | 'FR';

/**
 * Where a dataset comes from.
 * - `user`: real statements imported by the user. Raw data NEVER leaves the device.
 * - `demo`: synthetic statements bundled with the app. Safe to process in the cloud,
 *   so judges without Gemini Nano can still see the full pipeline.
 */
export type DataOrigin = 'demo' | 'user';

export const CATEGORIES = [
  'income_salary',
  'income_other',
  'internal_transfer',
  'housing',
  'loan_payment',
  'credit_card_payment',
  'bnpl',
  'payday_loan',
  'gambling',
  'overdraft_fee',
  'nsf_fee',
  'savings',
  'groceries',
  'utilities',
  'subscriptions',
  'transport',
  'cash_withdrawal',
  'other',
] as const;

export type Category = (typeof CATEGORIES)[number];

/** Who decided the category of a transaction. */
export type CategorySource = 'rule' | 'on_device' | 'in_cloud' | 'unclassified';

export interface Transaction {
  id: string;
  accountId: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  /** Signed amount in the account currency: credit > 0, debit < 0. */
  amount: number;
  currency: string;
  country: CountryCode;
  rawLabel: string;
  balance?: number;
  category?: Category;
  categorySource?: CategorySource;
  isInternalTransfer?: boolean;
}

export interface Account {
  id: string;
  name: string;
  currency: string;
  country: CountryCode;
  origin: DataOrigin;
  transactions: Transaction[];
}

export type CheckStatus = 'ok' | 'watch' | 'alert';

export type CheckId =
  | 'statement_coverage'
  | 'debt_ratio'
  | 'overdraft'
  | 'large_deposits'
  | 'gambling'
  | 'payday_loans'
  | 'savings_regularity';

export interface CheckResult {
  id: CheckId;
  status: CheckStatus;
  /** Short, plain-English title shown to the user. */
  title: string;
  /** One or two sentences, local only (may contain amounts). */
  detail: string;
  /** Transactions behind this check, shown on click. Never sent to the cloud. */
  transactionIds: string[];
}

export interface UserInputs {
  /** Required for countries whose lenders use gross income (US). */
  grossMonthlyIncome?: number;
  /** The mortgage payment the user is aiming for, all-in. */
  projectedHousingPayment: number;
}

export interface Metrics {
  monthsCovered: number;
  monthlyIncome: number;
  monthlySalary: number;
  incomeBase: number;
  monthlyDebtPayments: number;
  debtRatio: number;
  overdraftFeeCount: number;
  nsfCount: number;
  gamblingCount: number;
  gamblingMonthly: number;
  paydayCount: number;
  largeDepositCount: number;
  largeDepositTotal: number;
  savingsMonths: number;
}

export interface Analysis {
  country: CountryCode;
  metrics: Metrics;
  checks: CheckResult[];
}
