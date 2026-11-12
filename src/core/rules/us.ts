import type { RulePack } from './types';

export const US: RulePack = {
  country: 'US',
  currency: 'USD',
  locale: 'en-US',
  displayName: 'United States - conventional mortgage guidelines',
  statementMonths: 2,
  incomeBasis: 'gross',
  debtRatio: { label: 'DTI (back-end)', comfort: 0.36, reference: 0.43, max: 0.5 },
  largeDepositShareOfMonthlyIncome: 0.5,
  checks: [
    'statement_coverage',
    'debt_ratio',
    'recurring_obligations',
    'overdraft',
    'large_deposits',
    'payday_loans',
    'gambling',
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
  ],
};
