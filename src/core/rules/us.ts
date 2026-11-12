import type { RulePack } from './types';

export const US: RulePack = {
  country: 'US',
  program: 'conventional',
  currency: 'USD',
  locale: 'en-US',
  displayName: 'United States - conventional mortgage guidelines',
  statementMonths: 2,
  incomeBasis: 'gross',
  debtRatio: { label: 'Debt-to-income ratio', comfort: 0.36, reference: 0.43, max: 0.5 },
  largeDepositShareOfMonthlyIncome: 0.5,
  freshnessDays: 45,
  checks: [
    'statement_coverage',
    'debt_ratio',
    'recurring_obligations',
    'overdraft',
    'large_deposits',
    'payday_loans',
    'gambling',
    'cash_deposits',
    'statement_recency',
    'funds_to_close',
  ],
  letterType: 'letter_of_explanation',
  sources: [
    {
      topic: 'Large deposits (> 50% of monthly qualifying income)',
      url: 'https://selling-guide.fanniemae.com/sel/b3-4.2-02/depository-accounts',
      checkedOn: '2026-11-05',
    },
    {
      topic: 'DTI thresholds (43% QM reference, up to 50% with compensating factors)',
      url: 'https://www.opendoor.com/articles/debt-to-income-ratio-mortgage',
      checkedOn: '2026-11-05',
    },
    {
      topic: 'Overdraft / NSF red flags',
      url: 'https://themortgagereports.com/22079/bank-statements-3-things-mortgage-lenders-dont-want-to-see',
      checkedOn: '2026-11-05',
    },
    {
      topic: 'Two consecutive monthly statements, dated within 45 days of the application',
      url: 'https://selling-guide.fanniemae.com/sel/b3-4.4-02/requirements-certain-assets-du',
      checkedOn: '2026-11-12',
    },
    {
      topic: 'Cash deposits and recurring payments to individuals as red flags',
      url: 'https://joingerald.com/learn/debt--credit/what-mortgage-lenders-look-for-checklist',
      checkedOn: '2026-11-12',
    },
  ],
};

/** FHA (government-insured): 31/43 standard manual ratios, up to 40/50 with compensating factors. */
export const US_FHA: RulePack = {
  ...US,
  program: 'fha',
  displayName: 'United States - FHA (government-insured) guidelines',
  debtRatio: { label: 'Debt-to-income ratio', comfort: 0.43, reference: 0.47, max: 0.5 },
  checkNotes: {
    overdraft: 'FHA: a returned-payment (NSF) fee can send the file to manual underwriting, even after an automated approval.',
    debt_ratio: 'FHA standard ratios are 31% (housing) and 43% (total); up to 47% or 50% with documented compensating factors such as 3+ months of reserves.',
  },
  sources: [
    ...US.sources,
    { topic: 'FHA DTI 31/43, 37/47, 40/50 tiers', url: 'https://www.lower.com/mortgages/fha-loan/fha-loan-dti-requirements', checkedOn: '2026-11-12' },
    { topic: 'FHA NSF and manual underwriting', url: 'https://themortgagereports.com/22079/bank-statements-3-things-mortgage-lenders-dont-want-to-see', checkedOn: '2026-11-12' },
  ],
};

/** VA (veterans): 41% DTI benchmark; above it, residual income must exceed the guideline by 20%. */
export const US_VA: RulePack = {
  ...US,
  program: 'va',
  displayName: 'United States - VA (veterans) guidelines',
  debtRatio: { label: 'Debt-to-income ratio', comfort: 0.41, reference: 0.41, max: 0.5 },
  checkNotes: {
    debt_ratio: 'VA: 41% is a benchmark, not a cap. Above it, residual income must exceed the VA guideline by 20%.',
    overdraft: 'VA lenders ask for a letter explaining every overdraft or negative balance.',
  },
  sources: [
    ...US.sources,
    { topic: 'VA 41% DTI benchmark and residual income', url: 'https://www.ecfr.gov/current/title-38/chapter-I/part-36/subpart-B/section-36.4340', checkedOn: '2026-11-12' },
    { topic: 'VA residual income +20% above 41%', url: 'https://www.veteransunited.com/futurehomeowners/va-loan-debt-to-income-guidelines', checkedOn: '2026-11-12' },
  ],
};

/**
 * Bank statement loan (non-QM, self-employed): 12 or 24 months of statements instead of tax
 * returns. Qualifying income = eligible deposits (no transfers, refunds, loan proceeds or
 * peer-to-peer) averaged per month, minus an expense ratio for business accounts (50% default).
 */
export const US_BANK_STATEMENT: RulePack = {
  ...US,
  program: 'bank_statement',
  displayName: 'United States - bank statement loan (self-employed)',
  statementMonths: 12,
  incomeBasis: 'deposits',
  defaultExpenseRatio: 0.5,
  debtRatio: { label: 'Debt-to-income ratio', comfort: 0.43, reference: 0.5, max: 0.55 },
  checkNotes: {
    debt_ratio: 'Income = eligible deposits per month, minus the expense ratio for a business account. A lower ratio needs a CPA or third-party expense letter.',
  },
  sources: [
    ...US.sources,
    { topic: 'Bank statement loans: 12-24 months, exclusions, expense factor', url: 'https://housingwire.com/articles/how-bank-statement-loans-work-2025-guide-for-americas-10-million-self-employed-borrowers', checkedOn: '2026-11-12' },
    { topic: '100% of personal deposits, 50% standard business expense ratio, DTI up to 55%', url: 'https://admortgage.com/programs/bank_statement/', checkedOn: '2026-11-12' },
  ],
};
