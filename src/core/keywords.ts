import type { Category, Transaction } from './types';

/**
 * Deterministic pre-classification for unambiguous labels (fees, payroll, gambling...).
 * Runs before the model: it is free, instant, auditable, and catches the signals that
 * matter most to lenders even when no model is available.
 * Patterns cover English and French bank wording.
 */
const RULES: { category: Category; pattern: RegExp; sign?: 'credit' | 'debit' }[] = [
  { category: 'nsf_fee', pattern: /\b(nsf|insufficient funds|returned item fee|rejet de prelevement|rejet prlv|frais de rejet|commission d.intervention)\b/i, sign: 'debit' },
  { category: 'overdraft_fee', pattern: /\b(overdraft fee|od fee|overdraft charge|agios|interets debiteurs|frais de decouvert)\b/i, sign: 'debit' },
  { category: 'payday_loan', pattern: /\b(payday|cash advance loan|quick ?loan|pret express)\b/i },
  { category: 'gambling', pattern: /\b(casino|betting|sportsbook|poker|lottery|loterie|paris sportifs|pari sportif|turf|jeux d.argent)\b/i },
  { category: 'bnpl', pattern: /\b(pay in 4|buy now pay later|bnpl|paiement en 3 fois|paiement en 4 fois|3x sans frais|4x sans frais)\b/i, sign: 'debit' },
  { category: 'income_salary', pattern: /\b(payroll|salary|direct dep(osit)? payroll|salaire|paie|virement salaire)\b/i, sign: 'credit' },
  { category: 'housing', pattern: /\b(rent|loyer|mortgage pmt|echeance pret immo)\b/i, sign: 'debit' },
  { category: 'loan_payment', pattern: /\b(auto loan|car loan|student loan|loan pmt|loan payment|echeance pret|remboursement pret|credit auto|pret etudiant|pret perso)\b/i, sign: 'debit' },
  { category: 'credit_card_payment', pattern: /\b(credit card payment|card payment thank you|cc payment|remboursement carte)\b/i, sign: 'debit' },
  { category: 'cash_withdrawal', pattern: /\b(atm withdrawal|atm wd|retrait dab|retrait especes)\b/i, sign: 'debit' },
  // Everyday spending: not what lenders look for, but classifying it here keeps the model for the hard cases.
  { category: 'utilities', pattern: /\b(power|electric|water|gas bill|wireless|mobile|internet|fibre|fiber|energie|electricite|eau|box)\b/i, sign: 'debit' },
  { category: 'subscriptions', pattern: /\b(subscription|monthly|monthly plan|abonnement|streaming)\b/i, sign: 'debit' },
  { category: 'groceries', pattern: /\b(grocery|groceries|supermarket|market|marche|supermarche|epicerie)\b/i, sign: 'debit' },
  { category: 'transport', pattern: /\b(fuel|gas station|parking|transit|metro|navigo|sncf|peage|carburant|station)\b/i, sign: 'debit' },
];

/** Strips accents so patterns can be written without them. */
function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function classifyByKeywords(tx: Transaction): Category | undefined {
  const label = fold(tx.rawLabel);
  for (const rule of RULES) {
    if (rule.sign === 'credit' && tx.amount <= 0) continue;
    if (rule.sign === 'debit' && tx.amount >= 0) continue;
    if (rule.pattern.test(label)) return rule.category;
  }
  return undefined;
}

/** Applies keyword rules in place; returns the transactions the model still has to classify. */
export function applyKeywordRules(transactions: Transaction[]): Transaction[] {
  const remaining: Transaction[] = [];
  for (const tx of transactions) {
    if (tx.isInternalTransfer) {
      tx.category = 'internal_transfer';
      tx.categorySource = 'rule';
      continue;
    }
    const category = classifyByKeywords(tx);
    if (category) {
      tx.category = category;
      tx.categorySource = 'rule';
    } else {
      remaining.push(tx);
    }
  }
  return remaining;
}
