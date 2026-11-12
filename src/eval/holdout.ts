import type { Category, CountryCode } from '../core/types';
import type { EvalLine } from './dataset';

/**
 * Held-out lines: written on 12 Nov 2026, after the first Gemini Nano run on real hardware and
 * before any prompt change, with merchants and wording that appear nowhere in the main set, the
 * keyword rules or the prompt. They are never used to tune anything: if a prompt change helps
 * here too, it generalises; if it only helps on the main set, it was fitted to it.
 * All names are invented.
 */
type Row = [label: string, amount: number, truth: Category];

const EN: Row[] = [
  ['PAYROLLHUB HALVERSON DESIGN 1029', 2875, 'income_salary'],
  ['STATE UI BENEFIT PMT', 612, 'income_other'],
  ['DIVIDEND CREDIT', 14.2, 'income_other'],
  ['GREENLEAF HOMES LANDLORD PORTAL', -1525, 'housing'],
  ['HOA DUES WILLOW CREEK', -180, 'housing'],
  ['LAKEPOINT AUTO FINANCE ACH', -412.5, 'loan_payment'],
  ['EDUFUND SERVICING ACH', -233, 'loan_payment'],
  ['MARKETPLACE LENDING CO INSTL', -298, 'loan_payment'],
  ['AFTERCART 3 OF 4', -37.5, 'bnpl'],
  ['PAYLATER*SNEAKERHUB', -64.99, 'bnpl'],
  ['QUICKFUNDS NOW LOAN ADV', 400, 'payday_loan'],
  ['QUICKFUNDS NOW REPAYMENT', -460, 'payday_loan'],
  ['LUCKY RIVER CASINO', -200, 'gambling'],
  ['FANTASYPICKS SPORTSBOOK', -50, 'gambling'],
  ['RETURNED ITEM CHARGE', -35, 'nsf_fee'],
  ['EXTENDED OVERDRAWN BAL FEE', -25, 'overdraft_fee'],
  ['FRESHWAY MARKET #221', -86.4, 'groceries'],
  ['CITYLIGHT ELECTRIC AUTOPAY', -112.3, 'utilities'],
  ['FIBERNET HOME INTERNET', -65, 'utilities'],
  ['STREAMBOX MONTHLY', -15.99, 'subscriptions'],
  ['METRO TRANSIT FARE', -2.75, 'transport'],
  ['ATM WITHDRAWAL 5TH AVE', -100, 'cash_withdrawal'],
  ['BRANCH CASH DEP', 900, 'cash_deposit'],
  ['RETURN CREDIT HOMEGOODS', 45.1, 'refund'],
  ['PEDIATRIC CLINIC COPAY', -40, 'other'],
  ['HARDWARE DEPOT #88', -57.3, 'other'],
];

const FR: Row[] = [
  ['VIR ALLOCATIONS FAMILIALES', 248, 'income_other'],
  ['PRLV SEPA FONCIERE DES ALPES', -720, 'housing'],
  ['PRLV SEPA CREDIT AUTO MONTBLANC FINANCE', -289, 'loan_payment'],
  ['PRLV SEPA SOFIPRET CONSO ECH 12', -150, 'loan_payment'],
  ['CB PAIEMENT 4X ACHATPLUS', -55, 'bnpl'],
  ['CB PARIS EN LIGNE GOALBET', -30, 'gambling'],
  ['COMMISSION D INTERVENTION', -8, 'overdraft_fee'],
  ['FRAIS REJET PRLV', -20, 'nsf_fee'],
  ['CB PRIMEUR DU MARCHE', -23.8, 'groceries'],
  ['PRLV SEPA EAU DU GRAND LAC', -38, 'utilities'],
  ['CB TRANSPORTS URBAINS RECHARGE', -86.4, 'transport'],
  ['RETRAIT DAB 12/11', -60, 'cash_withdrawal'],
  ['VERSEMENT ESPECES AGENCE', 300, 'cash_deposit'],
  ['AVOIR CB MAISONDECO', 29.9, 'refund'],
  ['CB PHARMACIE DU PONT', -18.5, 'other'],
  ['CB LIBRAIRIE DES QUAIS', -24, 'other'],
];

export function holdoutSet(): EvalLine[] {
  const build = (rows: Row[], country: CountryCode, currency: string) =>
    rows.map(([rawLabel, amount, truth], i) => ({
      truth,
      tx: {
        id: `holdout-${country}-${i}`,
        accountId: `holdout-${country}`,
        date: `2026-11-${String((i % 28) + 1).padStart(2, '0')}`,
        amount,
        currency,
        country,
        rawLabel,
      },
    }));
  return [...build(EN, 'US', 'USD'), ...build(FR, 'FR', 'EUR')];
}
