import type { CountryCode, Transaction } from '../types';
import { parseAmount } from './parse-utils';

/**
 * Bank statements as PDF: the text is extracted on the device (pdf.ts) into positioned lines,
 * then turned into transactions in one of two ways:
 *
 *  - `parseWithLayout()`: plain code. Finds the column header (Date / Description / Debit /
 *    Credit...) and reads each row by position. Fast and exact when the layout is classic.
 *  - Gemini Nano, on the device (src/ai/models.ts), for layouts the code cannot read. Every
 *    item the model returns is checked against the page text by `validateModelItems()`: an
 *    amount that does not appear on the page is dropped, so the model cannot invent a line.
 */
export interface PdfItem {
  x: number;
  /** Rendered width, when known: columns are matched on the item's centre. */
  width?: number;
  text: string;
}
export interface PdfLine {
  page: number;
  y: number;
  items: PdfItem[];
}

export interface StatementOptions {
  accountId: string;
  currency: string;
  country: CountryCode;
}

export interface StatementParse {
  transactions: Transaction[];
  /** Lines that start with a date but could not be read. */
  unreadLines: number;
  method: 'layout' | 'on_device_model' | 'none';
}

type Column = 'date' | 'label' | 'debit' | 'credit' | 'amount' | 'balance';
const HEADER_WORDS: Record<Column, RegExp> = {
  date: /^(date|posting date|trans(action)? date|date operation|date d.operation)$/i,
  label: /^(description|details|transaction|libelle|libelle de l.operation|nature de l.operation|operation)$/i,
  debit: /^(debit|debits|withdrawals?|withdrawals?\/debits?|withdrawals? and other (debits|subtractions)|money out|paid out|payments)$/i,
  credit: /^(credit|credits|deposits?|deposits?\/credits?|deposits? and other (credits|additions)|money in|paid in)$/i,
  amount: /^(amount|montant)$/i,
  balance: /^(balance|solde|ending daily balance|daily balance|running balance)$/i,
};

const centre = (i: PdfItem) => i.x + (i.width ?? 0) / 2;
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/** Text of a line with its columns separated, as shown to the model. */
export function lineText(line: PdfLine): string {
  return line.items.map((i) => i.text.trim()).filter(Boolean).join(' | ');
}

const DATE_RE = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$|^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS_EN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_NAME_RE = /^(\d{1,2})?\s*([a-z]{3})[a-z]*\.?\s*(\d{1,2})?$/i;

/** Reads "09/14", "14/09/2026", "2026-09-14" or "Sep 14"; the year comes from the statement period. */
export function readDate(raw: string, country: CountryCode, year: number): string | null {
  const s = fold(raw);
  const m = s.match(DATE_RE);
  const iso = (y: number, mo: number, d: number) =>
    mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
  if (m) {
    if (m[4]) return iso(Number(m[4]), Number(m[5]), Number(m[6]));
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : year;
    return country === 'US' ? iso(y, a, b) : iso(y, b, a);
  }
  const n = s.match(MONTH_NAME_RE);
  if (n && (n[1] || n[3])) {
    const mo = MONTHS_EN.indexOf(n[2].slice(0, 3).toLowerCase()) + 1;
    if (mo > 0) return iso(year, mo, Number(n[1] ?? n[3]));
  }
  return null;
}

/** Statement year: the first 4-digit year between 2000 and 2099 in the first lines. */
export function guessYear(lines: PdfLine[], fallback: number): number {
  for (const l of lines.slice(0, 40)) {
    const m = lineText(l).match(/\b(20\d{2})\b/);
    if (m) return Number(m[1]);
  }
  return fallback;
}

const AMOUNT_RE = /^[-+(]?\s*[$€£]?\s*\d{1,3}([ ,.  ]?\d{3})*([.,]\d{2})\s*[$€£]?\s*(-|\)|cr|dr)?$/i;
const isAmount = (s: string) => AMOUNT_RE.test(s.trim());

function findHeader(lines: PdfLine[]): { index: number; columns: { col: Column; x: number }[] } | null {
  for (let i = 0; i < lines.length; i++) {
    const cols: { col: Column; x: number }[] = [];
    for (const item of lines[i].items) {
      const t = fold(item.text).toLowerCase();
      const col = (Object.keys(HEADER_WORDS) as Column[]).find((c) => HEADER_WORDS[c].test(t));
      if (col && !cols.some((c) => c.col === col)) cols.push({ col, x: centre(item) });
    }
    const hasMoney = cols.some((c) => c.col === 'amount' || c.col === 'debit' || c.col === 'credit');
    if (cols.some((c) => c.col === 'date') && hasMoney) return { index: i, columns: cols };
  }
  return null;
}

/** Deterministic reading of a classic statement table. */
export function parseWithLayout(lines: PdfLine[], opts: StatementOptions, fallbackYear: number): StatementParse {
  const year = guessYear(lines, fallbackYear);
  const header = findHeader(lines);
  if (!header) return { transactions: [], unreadLines: 0, method: 'none' };
  const moneyCols = header.columns.filter((c) => c.col !== 'date' && c.col !== 'label');
  const nearest = (x: number) =>
    moneyCols.reduce((best, c) => (Math.abs(c.x - x) < Math.abs(best.x - x) ? c : best), moneyCols[0]).col;

  const out: Transaction[] = [];
  let unread = 0;
  let last: Transaction | undefined;
  let lastPage = -1;
  for (const line of lines.slice(header.index + 1)) {
    if (findHeader([line])) continue; // header repeated on the next page
    const [first, ...rest] = line.items;
    const date = first ? readDate(first.text, opts.country, year) : null;
    if (!date) {
      // A wrapped description continues the previous transaction.
      const words = line.items.filter((i) => !isAmount(i.text)).map((i) => i.text.trim());
      if (last && words.length && words.length === line.items.length && line.page === lastPage) {
        last.rawLabel = `${last.rawLabel} ${words.join(' ')}`.slice(0, 160);
      }
      continue;
    }
    let amount: number | null = null;
    const label: string[] = [];
    for (const item of rest) {
      if (!isAmount(item.text)) {
        label.push(item.text.trim());
        continue;
      }
      const v = parseAmount(item.text.replace(/\bcr\b/i, '').replace(/\bdr\b/i, ''));
      if (v === null) continue;
      const col = nearest(centre(item));
      if (col === 'debit') amount = -Math.abs(v);
      else if (col === 'credit') amount = Math.abs(v);
      else if (col === 'amount') amount = /\bcr\b/i.test(item.text) ? Math.abs(v) : /\bdr\b/i.test(item.text) ? -Math.abs(v) : v;
    }
    if (amount === null || label.length === 0) {
      unread++;
      continue;
    }
    last = {
      id: `${opts.accountId}-${out.length}`,
      accountId: opts.accountId,
      date,
      amount,
      currency: opts.currency,
      country: opts.country,
      rawLabel: label.join(' '),
    };
    lastPage = line.page;
    out.push(last);
  }
  return { transactions: out, unreadLines: unread, method: out.length ? 'layout' : 'none' };
}

/** Splits lines into chunks small enough for the on-device context window (about 4k tokens). */
export function chunkLines(lines: PdfLine[], maxChars = 6000): string[] {
  const chunks: string[] = [];
  let cur: string[] = [];
  let size = 0;
  for (const l of lines) {
    const t = lineText(l);
    if (!t) continue;
    if (size + t.length > maxChars && cur.length) {
      chunks.push(cur.join('\n'));
      cur = [];
      size = 0;
    }
    cur.push(t);
    size += t.length + 1;
  }
  if (cur.length) chunks.push(cur.join('\n'));
  return chunks;
}

export interface ModelItem {
  date?: unknown;
  label?: unknown;
  amount?: unknown;
}

const digitsOf = (s: string) => s.replace(/[^\d]/g, '');

/**
 * Keeps only what the page supports: a valid date, a label made of words that are on the
 * page, and an amount whose digits appear on the page. Everything else is dropped.
 */
export function validateModelItems(items: ModelItem[], chunk: string, opts: StatementOptions, startId: number): Transaction[] {
  const tokens = new Set(chunk.split(/[\s|]+/).map(digitsOf).filter((d) => d.length >= 3));
  const words = new Set(fold(chunk).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  const out: Transaction[] = [];
  for (const it of items) {
    if (typeof it.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(it.date)) continue;
    if (typeof it.label !== 'string' || typeof it.amount !== 'number' || !Number.isFinite(it.amount) || it.amount === 0) continue;
    const cents = String(Math.round(Math.abs(it.amount) * 100));
    if (!tokens.has(cents)) continue;
    const labelWords = fold(it.label).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    if (!labelWords.length || !labelWords.every((w) => words.has(w))) continue;
    out.push({
      id: `${opts.accountId}-${startId + out.length}`,
      accountId: opts.accountId,
      date: it.date,
      amount: Math.round(it.amount * 100) / 100,
      currency: opts.currency,
      country: opts.country,
      rawLabel: it.label.trim().slice(0, 160),
    });
  }
  return out;
}
