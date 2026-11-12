import type { CheckId, CountryCode, LoanProgram } from '../types';

/**
 * A country rule pack. Thresholds are data, not code, so a new country is a new file.
 * Every pack records where its numbers come from and when they were last checked.
 * Source names stay in this file and the README: the UI and the demo video use
 * generic wording ("US conventional loan guidelines") to avoid third-party marks.
 */
export interface RulePack {
  country: CountryCode;
  program: LoanProgram;
  currency: string;
  locale: string;
  /** Short generic name shown in the UI. */
  displayName: string;
  /** How many months of statements lenders usually ask for. */
  statementMonths: number;
  /** Which income the debt ratio is computed on. */
  incomeBasis: 'gross' | 'net' | 'deposits';
  /** Bank statement loans: default share of business deposits treated as expenses. */
  defaultExpenseRatio?: number;
  /** Statements must be dated within this many days of the application. */
  freshnessDays?: number;
  /** Program-specific remarks added to a check's detail. */
  checkNotes?: Partial<Record<CheckId, string>>;
  debtRatio: {
    /** Label shown to the user, e.g. "DTI" or "taux d'effort". */
    label: string;
    /** At or below: comfortable. */
    comfort: number;
    /** At or below: acceptable but watched. */
    reference: number;
    /** Above: likely refused. */
    max: number;
  };
  /** A non-salary deposit above this share of monthly income must be explained. */
  largeDepositShareOfMonthlyIncome?: number;
  /** Which checks apply in this country. */
  checks: CheckId[];
  /** Name of the explanation letter lenders ask for. */
  letterType: 'letter_of_explanation' | 'note_explicative';
  sources: { topic: string; url: string; checkedOn: string }[];
}
