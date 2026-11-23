import type { Account } from './types';

/** A place where the printed balance does not follow from the lines before it. */
export interface BalanceBreak {
  account: string;
  /** Last date whose balance is known before the break (YYYY-MM-DD). */
  from: string;
  /** Date whose balance does not follow (YYYY-MM-DD). */
  to: string;
  /** The lines of that date, to show the user. */
  transactionIds: string[];
}

export interface BalanceContinuity {
  /** Lines whose running balance was checked. */
  checkedLines: number;
  breaks: BalanceBreak[];
}

const cents = (n: number) => Math.round(n * 100);

/**
 * Checks that the running balance printed on the statements follows from the lines: the balance
 * at the end of each day must equal the previous day's plus that day's amounts. A jump means a
 * line or a page is missing, or an amount was misread. Lenders ask for every page.
 *
 * Works day by day, so the order of lines within a day (newest or oldest first) does not matter,
 * and days that print no balance are carried into the next one. A file whose balance column is
 * something else (an available balance with holds, for instance) breaks on most days: it is then
 * not checked at all rather than flagged.
 */
export function checkBalanceContinuity(accounts: Account[]): BalanceContinuity {
  let checkedLines = 0;
  const breaks: BalanceBreak[] = [];
  for (const account of accounts) {
    const byDate = new Map<string, { amounts: number; balances: number[]; ids: string[] }>();
    for (const t of account.transactions) {
      const day = byDate.get(t.date) ?? { amounts: 0, balances: [], ids: [] };
      day.amounts += cents(t.amount);
      if (t.balance !== undefined && Number.isFinite(t.balance)) day.balances.push(cents(t.balance));
      day.ids.push(t.id);
      byDate.set(t.date, day);
    }
    const days = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
    let previous: { date: string; balances: number[] } | undefined;
    let pending = 0; // amounts of days with no printed balance since `previous`
    let transitions = 0;
    let lines = 0;
    const found: BalanceBreak[] = [];
    for (const [date, day] of days) {
      if (!day.balances.length) {
        pending += day.amounts;
        continue;
      }
      if (previous) {
        transitions++;
        lines += day.ids.length;
        const expected = previous.balances.map((b) => b + pending + day.amounts);
        // Any balance printed that day may be the end-of-day one; one cent of rounding allowed.
        const fits = day.balances.some((b) => expected.some((e) => Math.abs(b - e) <= 1));
        if (!fits) found.push({ account: account.name, from: previous.date, to: date, transactionIds: day.ids });
      }
      previous = { date, balances: day.balances };
      pending = 0;
    }
    // Not a running balance: say nothing rather than raise a false alarm.
    if (transitions === 0 || found.length > transitions / 4) continue;
    checkedLines += lines;
    breaks.push(...found);
  }
  return { checkedLines, breaks };
}
