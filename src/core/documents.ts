import type { CheckId, CheckResult, LoanProgram } from './types';

/**
 * What to gather for each orange or red light, before the lender asks. Generic wording, no
 * institution names. Programme-specific items are added where the rules differ.
 */
export interface DocumentItem {
  checkId: CheckId;
  text: string;
}

const BY_CHECK: Record<CheckId, string[]> = {
  statement_coverage: ['Every monthly statement of every account for the period, all pages, including blank ones'],
  statement_recency: ['The latest monthly statements (downloaded as PDF from online banking), all pages', 'Statements for any missing month'],
  debt_ratio: ['The latest statement of each loan, showing the monthly payment and the balance', 'Proof of any debt paid off recently (payoff letter or zero-balance statement)'],
  recurring_obligations: ['The contract or schedule of each instalment plan or lease, with its end date', 'For regular payments to a person: a short note on what they are (support order, repayment, shared bills)'],
  overdraft: ['A short explanation of each overdraft or returned payment, and what changed since'],
  large_deposits: ['Proof of where each large deposit came from: gift letter and the donor\'s statement, sale receipt, or the statement of your own account it came from'],
  gambling: ['Nothing to provide in advance; be ready to explain the gambling lines if asked'],
  payday_loans: ['Proof that each short-term loan is fully repaid'],
  savings_regularity: ['Statements of savings accounts the lender has not seen'],
  cash_deposits: ['A note on where each cash deposit came from, with any receipt'],
  funds_to_close: ['Statements of every account the closing money will come from', 'A gift letter if part of it is a gift'],
};

const PROGRAM_EXTRAS: Partial<Record<LoanProgram, DocumentItem[]>> = {
  bank_statement: [
    { checkId: 'debt_ratio', text: 'A CPA or third-party expense letter if your business expenses are below the 50% standard ratio' },
    { checkId: 'statement_coverage', text: 'Proof of business ownership and at least 12 months in business (licence, registration, CPA letter)' },
  ],
  fha: [{ checkId: 'overdraft', text: 'A letter of explanation for every returned-payment (NSF) fee: FHA files with NSF fees can be reviewed by hand' }],
  va: [{ checkId: 'overdraft', text: 'A letter explaining each overdraft or negative balance' }],
};

export function documentsFor(checks: CheckResult[], program: LoanProgram): DocumentItem[] {
  const flagged = checks.filter((c) => c.status !== 'ok').map((c) => c.id);
  const items = flagged.flatMap((id) => (BY_CHECK[id] ?? []).map((text) => ({ checkId: id, text })));
  const extras = (PROGRAM_EXTRAS[program] ?? []).filter((x) => flagged.includes(x.checkId));
  return [...items, ...extras];
}

/**
 * Gift letter, filled in on the device. Lenders usually ask for the donor, the relationship,
 * the amount, the date of transfer and a statement that no repayment is expected.
 */
export const GIFT_LETTER_TEMPLATE = `{{date}}

To whom it may concern,

I, {{donor_name}}, am the {{relationship}} of {{applicant_name}}. On {{gift_date}} I gave {{applicant_name}} a gift of {{gift_amount}}, transferred from my account at {{donor_bank}}, to be used toward the purchase of a home.

This is a gift. No repayment is expected or implied, in money or in services.

{{donor_name}}
{{donor_address}}
{{donor_phone}}

Signature: ____________________`;
