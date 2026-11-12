import type { RulePack } from './types';

export const FR: RulePack = {
  country: 'FR',
  currency: 'EUR',
  locale: 'fr-FR',
  displayName: 'France - mortgage lending rules',
  statementMonths: 3,
  incomeBasis: 'net',
  // The 35% cap is binding (insurance included); banks may exceed it for 20% of their lending.
  debtRatio: { label: "Debt ratio (taux d'effort)", comfort: 0.33, reference: 0.35, max: 0.35 },
  checks: [
    'statement_coverage',
    'debt_ratio',
    'recurring_obligations',
    'overdraft',
    'gambling',
    'payday_loans',
    'savings_regularity',
  ],
  letterType: 'note_explicative',
  sources: [
    {
      topic: '35% debt ratio cap and 20% exemption',
      url: 'https://selectra.info/finance/actualites/marche/credit-immobilier-endettement-35-derogations',
      checkedOn: '2026-11-05',
    },
    {
      topic: 'Three months of statements, every account',
      url: 'https://www.pretto.fr/pret-immobilier/pret-immobilier-banque/comptes-bancaires-demande-de-pret/',
      checkedOn: '2026-11-05',
    },
    {
      topic: 'Overdrafts, rejected debits, gambling, regular savings',
      url: 'https://www.pretto.fr/banque/verification-banque-releve-de-compte/',
      checkedOn: '2026-11-05',
    },
  ],
};
