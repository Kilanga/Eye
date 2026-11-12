import type { ObligationCandidate } from './recurring';
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
  'cash_deposit',
  'p2p_transfer',
  'refund',
  'other',
] as const;

export type Category = (typeof CATEGORIES)[number];

/** Who decided the category of a transaction. */
export type CategorySource = 'rule' | 'user' | 'on_device' | 'in_cloud' | 'unclassified';

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
  /** How sure the model was; low-confidence lines are the ones the app asks about. */
  categoryConfidence?: 'high' | 'low';
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
  | 'savings_regularity'
  | 'recurring_obligations'
  | 'cash_deposits'
  | 'statement_recency'
  | 'funds_to_close';

/** US loan programs; France has one standard set of rules. */
export const PROGRAMS = ['conventional', 'fha', 'va', 'bank_statement', 'standard'] as const;
export type LoanProgram = (typeof PROGRAMS)[number];

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
  /** The user's answer for each recurring payment flagged as possible credit (key = normalised label). */
  obligationDecisions?: Record<string, 'debt' | 'not_debt'>;
  /** Bank statement loans: business account (expense ratio applies) or personal account. */
  accountKind?: 'business' | 'personal';
  /** Bank statement loans: share of business deposits treated as expenses (default 50%). */
  expenseRatio?: number;
  /** Cash needed at closing (down payment + closing costs), to check funds and reserves. */
  cashToClose?: number;
  /** Date of the application, YYYY-MM-DD (defaults to today): statements must be recent. */
  applicationDate?: string;
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
  /** Recurring payments counted as debt (confirmed, or high confidence). */
  obligationsMonthly: number;
  /** Recurring payments that may be credit and wait for the user's answer. */
  obligationsPending: number;
  cashDepositCount: number;
  cashDepositTotal: number;
  /** Days between the last statement line and the application date. */
  statementAgeDays: number;
  /** Sum of the latest known balance of each account, when the files carry balances. */
  availableFunds?: number;
  /** Monthly qualifying income, for bank statement loans: eligible deposits net of expenses. */
  eligibleDepositsMonthly?: number;
  savingsMonths: number;
}

export interface Analysis {
  country: CountryCode;
  program: LoanProgram;
  metrics: Metrics;
  checks: CheckResult[];
  /** Recurring payments that may be credit, with whether each one is counted. */
  obligations: (ObligationCandidate & { counted: boolean })[];
}
