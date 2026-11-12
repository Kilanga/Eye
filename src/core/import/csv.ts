import type { CountryCode, Transaction } from '../types';
import { normaliseHeader, parseAmount, parseDate } from './parse-utils';

export interface ColumnMapping {
  date: number;
  label: number;
  amount?: number;
  debit?: number;
  credit?: number;
  balance?: number;
}

const ALIASES: Record<keyof ColumnMapping, string[]> = {
  date: ['date', 'transaction date', 'posting date', 'posted date', 'trans date', 'date operation', 'date d operation', 'date de l operation', 'date comptable'],
  label: ['description', 'transaction description', 'label', 'libelle', 'libelle operation', 'libelle de l operation', 'libelle simplifie', 'details', 'payee', 'merchant', 'memo', 'name', 'narrative', 'beneficiaire'],
  amount: ['amount', 'montant', 'montant eur', 'montant en euros', 'montant de l operation', 'transaction amount'],
  debit: ['debit', 'debits', 'withdrawal', 'withdrawals', 'money out', 'paid out', 'montant debit'],
  credit: ['credit', 'credits', 'deposit', 'deposits', 'money in', 'paid in', 'montant credit'],
  balance: ['balance', 'solde', 'running balance'],
};

/** Splits CSV text into rows, handling quotes and the three usual delimiters. */
export function parseCsvRows(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '');
  // Many exports start with a few lines of account details: judge the delimiter on the widest line.
  const head = clean.split(/\r?\n/, 15);
  const width = (d: string) => Math.max(...head.map((l) => l.split(d).length));
  const delimiter = [';', '\t', ','].reduce((best, d) => (width(d) > width(best) ? d : best));
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (inQuotes) {
      if (c === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cell += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += c;
    }
  }
  row.push(cell);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  return rows;
}

/** Guesses which column is which from the header row. Returns null if date or label is missing. */
export function detectMapping(header: string[]): ColumnMapping | null {
  const norm = header.map(normaliseHeader);
  const find = (key: keyof ColumnMapping): number | undefined => {
    const exact = norm.findIndex((h) => ALIASES[key].includes(h));
    if (exact > -1) return exact;
    const partial = norm.findIndex((h) => ALIASES[key].some((a) => h.startsWith(a)));
    return partial > -1 ? partial : undefined;
  };
  const date = find('date');
  const label = find('label');
  if (date === undefined || label === undefined) return null;
  const mapping: ColumnMapping = { date, label };
  const amount = find('amount');
  const debit = find('debit');
  const credit = find('credit');
  const balance = find('balance');
  if (amount !== undefined) mapping.amount = amount;
  if (debit !== undefined) mapping.debit = debit;
  if (credit !== undefined) mapping.credit = credit;
  if (balance !== undefined) mapping.balance = balance;
  if (mapping.amount === undefined && mapping.debit === undefined && mapping.credit === undefined) return null;
  return mapping;
}

export interface CsvImportOptions {
  accountId: string;
  currency: string;
  country: CountryCode;
  mapping?: ColumnMapping;
}

export interface CsvImportResult {
  transactions: Transaction[];
  skippedRows: number;
  mapping: ColumnMapping;
}

export function importCsv(text: string, opts: CsvImportOptions): CsvImportResult {
  const all = parseCsvRows(text);
  // The header is not always the first row (account number, period... above it).
  const headerIndex = opts.mapping ? 0 : all.slice(0, 15).findIndex((r) => detectMapping(r) !== null);
  const rows = all.slice(Math.max(headerIndex, 0));
  if (rows.length < 2) throw new Error('The CSV file has no data rows.');
  const mapping = opts.mapping ?? (headerIndex > -1 ? detectMapping(rows[0]) : null);
  if (!mapping) throw new Error('Could not find the date, description and amount columns.');
  const transactions: Transaction[] = [];
  let skippedRows = 0;
  rows.slice(1).forEach((r, i) => {
    const date = parseDate(r[mapping.date] ?? '', opts.country);
    const label = (r[mapping.label] ?? '').trim();
    let amount: number | null = null;
    if (mapping.amount !== undefined) {
      amount = parseAmount(r[mapping.amount] ?? '');
    } else {
      const debit = mapping.debit !== undefined ? parseAmount(r[mapping.debit] ?? '') : null;
      const credit = mapping.credit !== undefined ? parseAmount(r[mapping.credit] ?? '') : null;
      if (debit) amount = -Math.abs(debit);
      else if (credit) amount = Math.abs(credit);
    }
    if (!date || !label || amount === null) {
      skippedRows++;
      return;
    }
    const balance = mapping.balance !== undefined ? parseAmount(r[mapping.balance] ?? '') : null;
    transactions.push({
      id: `${opts.accountId}-${i}`,
      accountId: opts.accountId,
      date,
      amount,
      currency: opts.currency,
      country: opts.country,
      rawLabel: label,
      ...(balance !== null ? { balance } : {}),
    });
  });
  return { transactions, skippedRows, mapping };
}
