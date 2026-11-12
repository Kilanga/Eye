import type { Account, Transaction } from './types';

const MAX_DAYS_APART = 3;

function dayNumber(isoDate: string): number {
  return Math.round(Date.parse(`${isoDate}T00:00:00Z`) / 86_400_000);
}

export interface TransferMatch {
  outId: string;
  inId: string;
}

/**
 * Finds transfers between the user's own accounts: same currency, opposite amounts,
 * at most 3 days apart, on two different imported accounts. Matched transactions are
 * marked so they never count as income or spending (a savings-to-checking transfer
 * would otherwise look like a large deposit to a lender).
 * Cross-currency transfers are not matched yet (multi-currency is a stretch goal).
 */
export function matchInternalTransfers(accounts: Account[]): TransferMatch[] {
  const all = accounts.flatMap((a) => a.transactions);
  const outgoing = all.filter((t) => t.amount < 0).sort((a, b) => a.date.localeCompare(b.date));
  const incoming = all.filter((t) => t.amount > 0);
  const used = new Set<string>();
  const matches: TransferMatch[] = [];

  for (const out of outgoing) {
    let best: Transaction | undefined;
    let bestGap = Infinity;
    for (const inc of incoming) {
      if (used.has(inc.id) || inc.accountId === out.accountId || inc.currency !== out.currency) continue;
      if (Math.abs(inc.amount + out.amount) > 0.005) continue;
      const gap = Math.abs(dayNumber(inc.date) - dayNumber(out.date));
      if (gap <= MAX_DAYS_APART && gap < bestGap) {
        best = inc;
        bestGap = gap;
      }
    }
    if (best) {
      used.add(best.id);
      out.isInternalTransfer = true;
      best.isInternalTransfer = true;
      matches.push({ outId: out.id, inId: best.id });
    }
  }
  return matches;
}
