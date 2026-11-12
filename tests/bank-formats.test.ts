import { describe, expect, it } from 'vitest';
import { importCsv } from '../src/core/import/csv';

/**
 * Column layouts of the CSV exports of large US banks, as documented by import tools
 * (sources in the README). Every row below is invented.
 */
const opts = { accountId: 'a', currency: 'USD', country: 'US' as const };
const read = (csv: string) => importCsv(csv, opts);

describe('US bank CSV layouts', () => {
  it('Chase checking: Details, Posting Date, Description, Amount, Type, Balance, Check or Slip #', () => {
    const r = read(
      'Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #\n' +
        'DEBIT,10/14/2026,"CARD PURCHASE 10/13 GREENLEAF MARKET",-87.40,DEBIT_CARD,1234.56,,\n' +
        'CREDIT,10/15/2026,"BRIGHTWAVE LABS PAYROLL PPD ID: 123",2450.00,ACH_CREDIT,3684.56,,\n',
    );
    expect(r.transactions.map((t) => t.amount)).toEqual([-87.4, 2450]);
    expect(r.transactions[0].balance).toBeCloseTo(1234.56);
  });

  it('Bank of America: summary block above the header, Running Bal. column', () => {
    const r = read(
      'Description,,Summary Amt.\nBeginning balance as of 09/01/2026,,"3,200.00"\nTotal credits,,"4,900.00"\nTotal debits,,"-2,100.00"\nEnding balance as of 09/30/2026,,"6,000.00"\n\n' +
        'Date,Description,Amount,Running Bal.\n' +
        '09/01/2026,Beginning balance as of 09/01/2026,,"3,200.00"\n' +
        '09/03/2026,"BRIGHTWAVE LABS DES:PAYROLL ID:XXXXX","2,450.00","5,650.00"\n' +
        '09/05/2026,"MAPLE RIDGE DES:RENT","-1,450.00","4,200.00"\n',
    );
    expect(r.transactions).toHaveLength(2);
    expect(r.transactions[1]).toMatchObject({ date: '2026-09-05', amount: -1450, balance: 4200 });
  });

  it('Wells Fargo: no header row (date, amount, *, empty, description)', () => {
    const r = read(
      '"10/14/2026","-87.40","*","","PURCHASE AUTHORIZED ON 10/13 GREENLEAF MARKET CARD 1234"\n' +
        '"10/15/2026","2450.00","*","","BRIGHTWAVE LABS PAYROLL"\n' +
        '"10/16/2026","-35.00","*","","OVERDRAFT FEE"\n',
    );
    expect(r.mapping.headerless).toBe(true);
    expect(r.transactions.map((t) => [t.amount, t.rawLabel.slice(0, 8)])).toEqual([
      [-87.4, 'PURCHASE'],
      [2450, 'BRIGHTWA'],
      [-35, 'OVERDRAF'],
    ]);
  });

  it('Capital One 360: unsigned amounts with a Debit/Credit type column', () => {
    const r = read(
      'Account Number,Transaction Date,Transaction Amount,Transaction Type,Transaction Description,Balance\n' +
        '1234,10/14/26,87.4,Debit,Debit Card Purchase - GREENLEAF MARKET,1147.16\n' +
        '1234,10/15/26,2450,Credit,Deposit from BRIGHTWAVE LABS PAYROLL,3597.16\n',
    );
    expect(r.transactions.map((t) => [t.date, t.amount])).toEqual([
      ['2026-10-14', -87.4],
      ['2026-10-15', 2450],
    ]);
  });

  it('Citi: separate Debit and Credit columns, credit written negative', () => {
    const r = read('Status,Date,Description,Debit,Credit\nCleared,10/14/2026,GREENLEAF MARKET,87.40,\nCleared,10/15/2026,REFUND GREENLEAF MARKET,,-41.00\n');
    expect(r.transactions.map((t) => t.amount)).toEqual([-87.4, 41]);
  });

  it('U.S. Bank: Name is the payee, four-decimal amounts, ISO dates, waived fees skipped', () => {
    const r = read(
      'Date,Transaction,Name,Memo,Amount\n' +
        '2026-10-14,DEBIT,GREENLEAF MARKET,Download from usbank.com. GREENLEAF MARKET,-87.4000\n' +
        '2026-10-15,DEBIT,MONTHLY MAINTENANCE FEE WAIVED,Download from usbank.com.,0.0000\n',
    );
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0]).toMatchObject({ rawLabel: 'GREENLEAF MARKET', amount: -87.4, date: '2026-10-14' });
  });
});

import { parseWithLayout, type PdfLine } from '../src/core/import/statement-text';

const line = (page: number, y: number, ...cells: [number, string][]): PdfLine => ({ page, y, items: cells.map(([x, text]) => ({ x, text })) });

describe('US bank PDF layouts', () => {
  it('single signed Amount column with Balance (Chase-style), header repeated per page', () => {
    const lines = [
      line(1, 700, [40, 'Statement period: September 08, 2026 through October 06, 2026']),
      line(1, 600, [40, 'DATE'], [90, 'DESCRIPTION'], [420, 'AMOUNT'], [500, 'BALANCE']),
      line(1, 580, [90, 'Beginning Balance'], [500, '$3,900.82']),
      line(1, 560, [40, '09/08'], [90, 'Card Purchase 09/07 Greenleaf Market'], [420, '-87.40'], [500, '3,813.42']),
      line(2, 600, [40, 'DATE'], [90, 'DESCRIPTION'], [420, 'AMOUNT'], [500, 'BALANCE']),
      line(2, 580, [40, '09/10'], [90, 'Brightwave Labs Payroll PPD ID: 123'], [420, '2,450.00'], [500, '6,263.42']),
    ];
    const r = parseWithLayout(lines, opts, 2000);
    expect(r.transactions.map((t) => [t.date, t.amount])).toEqual([
      ['2026-09-08', -87.4],
      ['2026-09-10', 2450],
    ]);
  });

  it('Deposits/Credits and Withdrawals/Debits columns (Wells Fargo-style)', () => {
    const lines = [
      line(1, 700, [40, 'October 31, 2026']),
      line(1, 600, [40, 'Date'], [80, 'Check Number'], [150, 'Description'], [380, 'Deposits/Credits'], [460, 'Withdrawals/Debits'], [540, 'Ending daily balance']),
      line(1, 580, [40, '10/14'], [150, 'Purchase authorized on 10/13 Greenleaf Market'], [460, '87.40'], [540, '1,147.16']),
      line(1, 560, [40, '10/15'], [150, 'Brightwave Labs Payroll'], [380, '2,450.00'], [540, '3,597.16']),
    ];
    const r = parseWithLayout(lines, opts, 2000);
    expect(r.transactions.map((t) => t.amount)).toEqual([-87.4, 2450]);
  });
});
