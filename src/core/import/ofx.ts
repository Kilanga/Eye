import type { CountryCode, Transaction } from '../types';
import { parseAmount, parseDate } from './parse-utils';

/**
 * Minimal OFX/QFX reader (SGML 1.x and XML 2.x). Reads STMTTRN blocks only:
 * DTPOSTED, TRNAMT, NAME, MEMO, FITID. Runs entirely in the browser.
 */
export function importOfx(
  text: string,
  opts: { accountId: string; country: CountryCode; currency?: string },
): { transactions: Transaction[]; currency: string } {
  const currency = (tag(text, 'CURDEF') ?? opts.currency ?? 'USD').toUpperCase();
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  const transactions: Transaction[] = [];
  blocks.forEach((block, i) => {
    const body = block.split(/<\/STMTTRN>/i)[0];
    const date = parseDate(tag(body, 'DTPOSTED') ?? '', opts.country);
    const amount = parseAmount(tag(body, 'TRNAMT') ?? '');
    const label = [tag(body, 'NAME'), tag(body, 'MEMO')].filter(Boolean).join(' - ').trim();
    if (!date || amount === null || !label) return;
    transactions.push({
      id: `${opts.accountId}-${tag(body, 'FITID') ?? i}`,
      accountId: opts.accountId,
      date,
      amount,
      currency,
      country: opts.country,
      rawLabel: label,
    });
  });
  return { transactions, currency };
}

function tag(text: string, name: string): string | undefined {
  const m = new RegExp(`<${name}>([^<\\r\\n]*)`, 'i').exec(text);
  return m ? m[1].trim() : undefined;
}
