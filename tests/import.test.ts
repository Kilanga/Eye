import { describe, expect, it } from 'vitest';
import { importCsv } from '../src/core/import/csv';
import { importOfx } from '../src/core/import/ofx';
import { parseAmount, parseDate } from '../src/core/import/parse-utils';
import { matchInternalTransfers } from '../src/core/transfers';
import { fillTemplate, listPlaceholders } from '../src/core/letter';
import { accountToCsv, frClean } from '../src/demo/generate';
import type { Account } from '../src/core/types';

describe('parse utils', () => {
  it('parses US and FR amounts', () => {
    expect(parseAmount('$1,234.56')).toBeCloseTo(1234.56);
    expect(parseAmount('(45.00)')).toBeCloseTo(-45);
    expect(parseAmount('-1 234,56 €')).toBeCloseTo(-1234.56);
    expect(parseAmount('12,5')).toBeCloseTo(12.5);
    expect(parseAmount('abc')).toBeNull();
  });
  it('parses dates by country', () => {
    expect(parseDate('03/04/2026', 'US')).toBe('2026-03-04');
    expect(parseDate('03/04/2026', 'FR')).toBe('2026-04-03');
    expect(parseDate('2026-10-01', 'FR')).toBe('2026-10-01');
    expect(parseDate('20261001', 'US')).toBe('2026-10-01');
  });
});

describe('CSV import', () => {
  it('reads a French export with debit/credit columns', () => {
    const csv = 'Date;Libellé;Débit;Crédit\n01/10/2026;VIR SALAIRE;;2850,00\n02/10/2026;LOYER;980,00;\n';
    const r = importCsv(csv, { accountId: 'a', currency: 'EUR', country: 'FR' });
    expect(r.transactions).toHaveLength(2);
    expect(r.transactions[0].amount).toBeCloseTo(2850);
    expect(r.transactions[1].amount).toBeCloseTo(-980);
  });
  it('round-trips the demo CSV', () => {
    const acc = frClean().accounts[0];
    const r = importCsv(accountToCsv(acc), { accountId: 'x', currency: 'EUR', country: 'FR' });
    expect(r.transactions).toHaveLength(acc.transactions.length);
  });
});

describe('OFX import', () => {
  it('reads STMTTRN blocks', () => {
    const ofx = `OFXHEADER:100\n<OFX><CURDEF>USD<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261005120000<TRNAMT>-42.10<FITID>1<NAME>CORNER MARKET</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261015<TRNAMT>2450.00<FITID>2<NAME>PAYROLL</STMTTRN></OFX>`;
    const r = importOfx(ofx, { accountId: 'o', country: 'US' });
    expect(r.transactions).toHaveLength(2);
    expect(r.transactions[0].date).toBe('2026-10-05');
    expect(r.transactions[1].amount).toBeCloseTo(2450);
    expect(r.transactions[0].currency).toBe('USD');
  });
});

describe('internal transfers', () => {
  it('pairs opposite amounts across accounts within 3 days', () => {
    const mk = (id: string, txs: [string, number][]): Account => ({
      id, name: id, currency: 'USD', country: 'US', origin: 'demo',
      transactions: txs.map(([date, amount], i) => ({ id: `${id}-${i}`, accountId: id, date, amount, currency: 'USD', country: 'US', rawLabel: 'TRANSFER' })),
    });
    const a = mk('chk', [['2026-10-01', -400], ['2026-10-10', -50]]);
    const b = mk('sav', [['2026-10-02', 400], ['2026-10-20', 50]]);
    matchInternalTransfers([a, b]);
    expect(a.transactions[0].isInternalTransfer).toBe(true);
    expect(b.transactions[0].isInternalTransfer).toBe(true);
    expect(a.transactions[1].isInternalTransfer).toBeFalsy();
  });
});

describe('letter template', () => {
  it('fills placeholders locally and reports missing ones', () => {
    const t = 'On {{deposit_date}} I received {{deposit_amount}} from {{source}}.';
    expect(listPlaceholders(t)).toEqual(['deposit_date', 'deposit_amount', 'source']);
    const r = fillTemplate(t, { deposit_date: 'Oct 3', deposit_amount: '$6,000' });
    expect(r.text).toContain('$6,000');
    expect(r.missing).toEqual(['source']);
  });
});
