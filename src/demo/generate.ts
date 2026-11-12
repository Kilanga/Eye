import type { Account, CountryCode, LoanProgram, Transaction } from '../core/types';

/**
 * Synthetic statements for the demo and the tests. Every bank, employer and merchant
 * name is invented: no real brand appears anywhere (contest rules forbid third-party marks).
 * Deterministic: the same seed always produces the same statements.
 */
export interface DemoPersona {
  id: string;
  country: CountryCode;
  title: string;
  description: string;
  /** Date of the last statement line, used as the snapshot date in follow-up demos. */
  asOf: string;
  grossMonthlyIncome?: number;
  projectedHousingPayment: number;
  program?: LoanProgram;
  accountKind?: 'business' | 'personal';
  cashToClose?: number;
  accounts: Account[];
}

/** Adds a running balance, in date order, as statements print it. */
function withBalances(txs: Transaction[], start: number): Transaction[] {
  let b = start;
  txs
    .slice()
    .sort((x, y) => x.date.localeCompare(y.date))
    .forEach((t) => {
      b = Math.round((b + t.amount) * 100) / 100;
      t.balance = b;
    });
  return txs;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Builder {
  private n = 0;
  readonly txs: Transaction[] = [];
  constructor(
    private accountId: string,
    private currency: string,
    private country: CountryCode,
  ) {}
  add(date: string, amount: number, rawLabel: string): void {
    this.txs.push({
      id: `${this.accountId}-${this.n++}`,
      accountId: this.accountId,
      date,
      amount: Math.round(amount * 100) / 100,
      currency: this.currency,
      country: this.country,
      rawLabel,
    });
  }
}

const d = (y: number, m: number, day: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

type Month = [year: number, month: number];

/**
 * Maya's statements over any two-month window. Incidents happened in September and October
 * only, so later windows show the effect of the 90-day plan.
 */
function maya(window: Month[]): Account[] {
  const r = rng(42);
  const chk = new Builder('us-checking', 'USD', 'US');
  const sav = new Builder('us-savings', 'USD', 'US');
  for (const [y, m] of window) {
    chk.add(d(y, m, 1), -1450, 'MAPLE RIDGE APARTMENTS RENT');
    chk.add(d(y, m, 3), 2450, 'BRIGHTWAVE LABS PAYROLL DIRECT DEP');
    chk.add(d(y, m, 17), 2450, 'BRIGHTWAVE LABS PAYROLL DIRECT DEP');
    chk.add(d(y, m, 5), -385, 'SUMMIT AUTO LOAN PMT');
    chk.add(d(y, m, 12), -210, 'CLEARPATH STUDENT LOAN PAYMENT');
    chk.add(d(y, m, 8), -142.37, 'CITY POWER & WATER');
    chk.add(d(y, m, 20), -65, 'NIMBUS MOBILE WIRELESS');
    chk.add(d(y, m, 22), -15.99, 'STREAMBOX MONTHLY');
    for (let i = 0; i < 6; i++) chk.add(d(y, m, 2 + i * 4), -(60 + r() * 70), 'GREENLEAF MARKET #214');
    for (let i = 0; i < 3; i++) chk.add(d(y, m, 6 + i * 7), -(35 + r() * 25), 'QUICKFUEL STATION 88');
    // Everyday lines with no keyword: what Gemini Nano is for.
    chk.add(d(y, m, 9), -(5 + r() * 6), 'CAFE LUNA 0042');
    chk.add(d(y, m, 13), -(15 + r() * 30), 'WELLCARE PHARMACY #318');
    chk.add(d(y, m, 19), -(25 + r() * 60), 'MEGAMART ONLINE ORDER');
    chk.add(d(y, m, 24), -(12 + r() * 20), 'RIDEGO *TRIP');
    chk.add(d(y, m, 25), -400, 'TRANSFER TO SAVINGS XXXX5521');
    sav.add(d(y, m, 26), 400, 'TRANSFER FROM CHECKING XXXX1180');
    // A furniture payment plan that ended in October: looks like nothing, a lender counts it.
    if (y === 2026 && (m === 9 || m === 10)) chk.add(d(y, m, 15), -60, 'BRIGHTHOME 0423 AUTOPAY');
    if (y === 2026 && m === 9) chk.add(d(y, m, 28), -35, 'OVERDRAFT FEE');
    if (y === 2026 && m === 10) {
      chk.add(d(y, m, 29), -35, 'OVERDRAFT FEE');
      chk.add(d(y, m, 14), 6000, 'MOBILE CHECK DEPOSIT');
      chk.add(d(y, m, 18), -40, 'LUCKY STAR CASINO ONLINE');
    }
  }
  return [
    { id: 'us-checking', name: 'Northwind Bank - Checking', currency: 'USD', country: 'US', origin: 'demo', transactions: chk.txs },
    { id: 'us-savings', name: 'Northwind Bank - Savings', currency: 'USD', country: 'US', origin: 'demo', transactions: sav.txs },
  ];
}

/** US: "almost ready" - one large deposit to explain, two overdraft fees, a little gambling. */
export function usAlmostReady(): DemoPersona {
  return {
    id: 'us-almost-ready',
    country: 'US',
    title: 'Maya - Austin, TX (synthetic)',
    description: 'Two accounts, two months. Almost ready, with a large deposit to explain.',
    asOf: '2026-10-31',
    grossMonthlyIncome: 6400,
    projectedHousingPayment: 1850,
    accounts: maya([[2026, 9], [2026, 10]]),
  };
}

/** Maya one month into her plan: October still shows, November is clean, target home cheaper. */
export function usFollowUp30(): DemoPersona {
  return {
    id: 'us-follow-up-30',
    country: 'US',
    title: 'Maya - 30 days later',
    description: 'Same accounts, October and November. The plan is under way.',
    asOf: '2026-11-30',
    grossMonthlyIncome: 6400,
    projectedHousingPayment: 1700,
    accounts: maya([[2026, 10], [2026, 11]]),
  };
}

/** Maya two months in: the window the lender reads is entirely after the plan started. */
export function usFollowUp60(): DemoPersona {
  return {
    id: 'us-follow-up-60',
    country: 'US',
    title: 'Maya - 60 days later',
    description: 'November and December: two clean months.',
    asOf: '2026-12-31',
    grossMonthlyIncome: 6400,
    projectedHousingPayment: 1700,
    accounts: maya([[2026, 11], [2026, 12]]),
  };
}

/** FR: "clean" - regular savings, no incident. Labels in French, as French banks write them. */
export function frClean(): DemoPersona {
  const r = rng(7);
  const cc = new Builder('fr-courant', 'EUR', 'FR');
  const liv = new Builder('fr-livret', 'EUR', 'FR');
  for (const m of [8, 9, 10]) {
    cc.add(d(2026, m, 1), 2850, 'VIR SALAIRE ATELIERS VERCORS');
    cc.add(d(2026, m, 5), -980, 'PRLV LOYER SCI DES TILLEULS');
    cc.add(d(2026, m, 10), -210, 'ECHEANCE PRET AUTO CREDIT DU LAC');
    cc.add(d(2026, m, 12), -74.5, 'PRLV ENERGIE ALPES');
    cc.add(d(2026, m, 15), -29.99, 'PRLV BOX FIBRE ONDINE');
    for (let i = 0; i < 6; i++) cc.add(d(2026, m, 3 + i * 4), -(40 + r() * 55), 'CB MARCHE DU COIN');
    cc.add(d(2026, m, 20), -75.2, 'NAVIGO TRANSPORTS');
    cc.add(d(2026, m, 28), -150, 'VIR VERS LIVRET EPARGNE');
    liv.add(d(2026, m, 28), 150, 'VIR DEPUIS COMPTE COURANT');
  }
  return {
    id: 'fr-clean',
    country: 'FR',
    title: 'Camille - Lyon (synthetic)',
    description: 'Current account and savings account, three months, regular savings.',
    asOf: '2026-10-31',
    projectedHousingPayment: 700,
    accounts: [
      { id: 'fr-courant', name: 'Banque Lumiere - Compte courant', currency: 'EUR', country: 'FR', origin: 'demo', transactions: cc.txs },
      { id: 'fr-livret', name: 'Banque Lumiere - Livret', currency: 'EUR', country: 'FR', origin: 'demo', transactions: liv.txs },
    ],
  };
}

/**
 * US self-employed: a freelance designer applying for a bank statement loan. Twelve months of
 * a business account (client payments, owner draws) and a personal account. Story: the ratio is
 * just above the comfortable zone, a regular payment to a person needs explaining, and two cash
 * deposits cannot be traced.
 */
export function usSelfEmployed(): DemoPersona {
  const r = rng(11);
  const biz = new Builder('us-biz', 'USD', 'US');
  const per = new Builder('us-personal', 'USD', 'US');
  const clients = ['ACH CREDIT HARBORLINE CO INV', 'CLIENT PAYMENT NORTHPEAK STUDIO', 'DEPOSIT FROM BLUEFERN AGENCY'];
  for (let k = 0; k < 12; k++) {
    const y = k < 2 ? 2025 : 2026;
    const m = ((10 + k) % 12) + 1; // Nov 2025 .. Oct 2026
    clients.forEach((c, i) => biz.add(d(y, m, 4 + i * 9), 3000 * (0.85 + r() * 0.3), c.endsWith('INV') ? `${c} ${1040 + k * 3 + i}` : c));
    biz.add(d(y, m, 6), -54.99, 'DESIGNSUITE SUBSCRIPTION');
    biz.add(d(y, m, 11), -(120 + r() * 80), 'ADS PLATFORM CHARGE');
    biz.add(d(y, m, 18), -(300 + r() * 500), 'PRINTWORKS STUDIO SUPPLIES');
    biz.add(d(y, m, 22), -(1200 + r() * 600), 'CONTRACTOR PAYMENT R CHEN DESIGN');
    biz.add(d(y, m, 28), -4500, 'TRANSFER TO PERSONAL CHK 4410');
    per.add(d(y, m, 28), 4500, 'TRANSFER FROM BUSINESS CHK 7702');
    per.add(d(y, m, 1), -1400, 'RENT PAYMENT ASPEN COURT');
    per.add(d(y, m, 7), -350, 'MESA AUTO LOAN PMT');
    per.add(d(y, m, 15), -300, 'ZELLE PAYMENT TO MARIA LOPEZ');
    per.add(d(y, m, 9), -(130 + r() * 30), 'CITY POWER & WATER');
    for (let i = 0; i < 5; i++) per.add(d(y, m, 3 + i * 5), -(70 + r() * 90), 'GREENLEAF MARKET #214');
    per.add(d(y, m, 20), -(250 + r() * 400), 'MEGAMART ONLINE ORDER');
    per.add(d(y, m, 24), -(80 + r() * 200), 'CAFE LUNA 0042');
  }
  biz.add('2026-02-12', 118.4, 'REFUND PRINTWORKS STUDIO SUPPLIES');
  biz.add('2026-03-20', 400, 'ZELLE FROM K NGUYEN');
  per.add('2026-05-09', 900, 'CASH DEPOSIT BRANCH 044');
  per.add('2026-08-14', 900, 'CASH DEPOSIT BRANCH 044');
  return {
    id: 'us-self-employed',
    country: 'US',
    title: 'Diego - Denver, self-employed (synthetic)',
    description: 'Freelance designer, 12 months of business and personal statements, bank statement loan.',
    asOf: '2026-10-31',
    program: 'bank_statement',
    accountKind: 'business',
    projectedHousingPayment: 1650,
    cashToClose: 30000,
    accounts: [
      { id: 'us-biz', name: 'Northwind Bank - Business checking', currency: 'USD', country: 'US', origin: 'demo', transactions: withBalances(biz.txs, 8000) },
      { id: 'us-personal', name: 'Northwind Bank - Personal checking', currency: 'USD', country: 'US', origin: 'demo', transactions: withBalances(per.txs, 5000) },
    ],
  };
}

export const DEMO_PERSONAS: (() => DemoPersona)[] = [usAlmostReady, usFollowUp30, usFollowUp60, usSelfEmployed, frClean];

/** Exports an account as CSV so the import screen can be tested with the same data. */
export function accountToCsv(account: Account): string {
  const header = 'Date,Description,Amount';
  const lines = account.transactions
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((t) => `${t.date},"${t.rawLabel.replace(/"/g, '""')}",${t.amount.toFixed(2)}`);
  return [header, ...lines].join('\n');
}
