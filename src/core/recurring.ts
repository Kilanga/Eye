import type { Category, Transaction } from './types';

/**
 * "Hidden debts": recurring fixed payments that are really credit (a furniture payment plan,
 * a revolving credit, a car lease) but do not look like a loan in the statement. Lenders find
 * them and count them in the debt ratio; applicants forget them.
 *
 * Pure code: groups outgoing payments by a normalised label and keeps the ones that come back
 * every month for about the same amount. Strong wording ("installment", "lease", "echeance")
 * makes a candidate `high` confidence (counted unless the user says otherwise); anything else
 * is `medium` and only counted once the user confirms it.
 */
export type Confidence = 'high' | 'medium';
export type ObligationDecision = 'debt' | 'not_debt';

export interface ObligationCandidate {
  key: string;
  exampleLabel: string;
  monthlyAmount: number;
  months: number;
  confidence: Confidence;
  /** `credit`: looks like a loan or a lease; `person`: regular payments to a person (private loan, child support...). */
  kind: 'credit' | 'person';
  transactionIds: string[];
}

/** Categories that are already accounted for, or are clearly not credit. */
const SETTLED: ReadonlySet<Category> = new Set<Category>([
  'housing',
  'loan_payment',
  'bnpl',
  'credit_card_payment',
  'payday_loan',
  'internal_transfer',
  'savings',
  'groceries',
  'utilities',
  'subscriptions',
  'transport',
  'overdraft_fee',
  'nsf_fee',
  'gambling',
  'cash_withdrawal',
]);

const CREDIT_WORDING =
  /\b(installment|instalment|financing|finance plan|payment plan|credit plan|lease|leasing|loa|lld|credit renouvelable|reserve d.argent|mensualite|echeance|financement)\b/i;

export function normaliseLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z ]+/g, ' ')
    .replace(/\b(PRLV|SEPA|CB|CARTE|POS|ACH|DEBIT|PAYMENT|PMT|AUTOPAY|REF|ECH)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 3)
    .join(' ');
}

export function findRecurringObligations(transactions: Transaction[]): ObligationCandidate[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (t.amount >= 0 || t.isInternalTransfer) continue;
    const strong = CREDIT_WORDING.test(t.rawLabel.normalize('NFD').replace(/[̀-ͯ]/g, ''));
    if (t.category && SETTLED.has(t.category) && !strong) continue;
    if (t.category === 'loan_payment' || t.category === 'bnpl') continue; // already in the ratio
    const key = normaliseLabel(t.rawLabel);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }

  const out: ObligationCandidate[] = [];
  for (const [key, txs] of groups) {
    const months = new Set(txs.map((t) => t.date.slice(0, 7)));
    if (months.size < 2) continue;
    const toPerson = txs.every((t) => t.category === 'p2p_transfer');
    const amounts = txs.map((t) => Math.abs(t.amount)).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];
    // Payments to a person vary more than a loan instalment.
    if (amounts.some((a) => Math.abs(a - median) > (toPerson ? 0.25 : 0.1) * median)) continue;
    if (txs.length > months.size * 2) continue; // several times a month: spending, not an instalment
    if (median < 25) continue; // too small to move a lender's ratio
    const strong = txs.some((t) => CREDIT_WORDING.test(t.rawLabel.normalize('NFD').replace(/[̀-ͯ]/g, '')));
    out.push({
      key,
      exampleLabel: txs[0].rawLabel,
      monthlyAmount: Math.round(median * 100) / 100,
      months: months.size,
      confidence: strong && !toPerson ? 'high' : 'medium',
      kind: toPerson ? 'person' : 'credit',
      transactionIds: txs.map((t) => t.id),
    });
  }
  return out.sort((a, b) => b.monthlyAmount - a.monthlyAmount);
}

/** High confidence counts unless dismissed; medium counts only once confirmed. */
export function isCounted(c: ObligationCandidate, decisions: Record<string, ObligationDecision> = {}): boolean {
  const d = decisions[c.key];
  return d ? d === 'debt' : c.confidence === 'high';
}
