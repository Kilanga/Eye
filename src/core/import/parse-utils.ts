import type { CountryCode } from '../types';

/** Parses "1 234,56", "1,234.56", "(35.00)", "-35 €", "$1,200" into a number. */
export function parseAmount(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[\s  ]/g, '').replace(/[€$£]|EUR|USD|GBP|CAD/gi, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // The separator that comes last is the decimal one.
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma > -1) {
    const decimals = s.length - lastComma - 1;
    s = decimals > 0 && decimals <= 2 ? s.replace(/,/g, (_match: string, i: number) => (i === lastComma ? '.' : '')) : s.replace(/,/g, '');
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return negative ? -n : n;
}

/**
 * Parses a date to ISO YYYY-MM-DD. Day/month order for slashed dates follows the
 * country: day first for FR, month first for US.
 */
export function parseDate(raw: string, country: CountryCode): string | null {
  const s = raw.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s);
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const [a, b] = [Number(m[1]), Number(m[2])];
    const [day, month] = country === 'US' ? [b, a] : [a, b];
    return iso(year, month, day);
  }
  m = /^(\d{4})(\d{2})(\d{2})/.exec(s); // OFX style 20261103...
  if (m) return iso(+m[1], +m[2], +m[3]);
  return null;
}

function iso(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Normalises a header cell for alias matching: lower case, no accents, single spaces. */
export function normaliseHeader(h: string): string {
  return h
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Longest label kept, as for PDF lines: real statement labels are far shorter. */
export const MAX_LABEL_LENGTH = 160;

/**
 * Cleans a label read from a file: control characters, line and tab breaks, and the invisible
 * characters that reorder text (bidirectional overrides) become spaces; runs of spaces collapse.
 * A label then stays on one line, so it can neither forge extra lines in an on-device prompt
 * (lines are tab-separated, one per line) nor show other text on screen than what the bank wrote.
 */
export function cleanLabel(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LABEL_LENGTH);
}

/** Largest statement file read, in bytes. A year of PDF statements is a few megabytes. */
export const MAX_FILE_BYTES = 30 * 1024 * 1024;

/** A plain reason when a file is too large to read in the tab, or null when it is fine. */
export function fileTooLarge(bytes: number): string | null {
  return bytes > MAX_FILE_BYTES
    ? `this file is ${Math.round(bytes / 1024 / 1024)} MB; statements over ${MAX_FILE_BYTES / 1024 / 1024} MB are not read, so the tab does not freeze. Export fewer months per file.`
    : null;
}
