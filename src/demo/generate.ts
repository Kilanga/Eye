import type { Account, CountryCode, Transaction } from '../core/types';

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
  grossMonthlyIncome?: number;
  projectedHousingPayment: number;
  accounts: Account[];
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

/** US: "almost ready" - one large deposit to explain, two overdraft fees, a little gambling. */
export function usAlmostReady(): DemoPersona {
  const r = rng(42);
  const chk = new Builder('us-checking', 'USD', 'US');
  const sav = new Builder('us-savings', 'USD', 'US');
  for (const m of [9, 10]) {
    chk.add(d(2026, m, 1), -1450, 'MAPLE RIDGE APARTMENTS RENT');
    chk.add(d(2026, m, 3), 2450, 'BRIGHTWAVE LABS PAYROLL DIRECT DEP');
    chk.add(d(2026, m, 17), 2450, 'BRIGHTWAVE LABS PAYROLL DIRECT DEP');
    chk.add(d(2026, m, 5), -385, 'SUMMIT AUTO LOAN PMT');
    chk.add(d(2026, m, 12), -210, 'CLEARPATH STUDENT LOAN PAYMENT');
    chk.add(d(2026, m, 8), -142.37, 'CITY POWER & WATER');
    chk.add(d(2026, m, 20), -65, 'NIMBUS MOBILE WIRELESS');
    chk.add(d(2026, m, 22), -15.99, 'STREAMBOX MONTHLY');
    for (let i = 0; i < 6; i++) chk.add(d(2026, m, 2 + i * 4), -(60 + r() * 70), 'GREENLEAF MARKET #214');
    for (let i = 0; i < 3; i++) chk.add(d(2026, m, 6 + i * 7), -(35 + r() * 25), 'QUICKFUEL STATION 88');
    chk.add(d(2026, m, 25), -400, 'TRANSFER TO SAVINGS XXXX5521');
    sav.add(d(2026, m, 26), 400, 'TRANSFER FROM CHECKING XXXX1180');
  }
  chk.add(d(2026, 9, 28), -35, 'OVERDRAFT FEE');
  chk.add(d(2026, 10, 29), -35, 'OVERDRAFT FEE');
  chk.add(d(2026, 10, 14), 6000, 'MOBILE CHECK DEPOSIT');
  chk.add(d(2026, 10, 18), -40, 'LUCKY STAR CASINO ONLINE');
  return {
    id: 'us-almost-ready',
    country: 'US',
    title: 'Maya - Austin, TX (synthetic)',
    description: 'Two accounts, two months. Almost ready, with a large deposit to explain.',
    grossMonthlyIncome: 6400,
    projectedHousingPayment: 1850,
    accounts: [
      { id: 'us-checking', name: 'Northwind Bank - Checking', currency: 'USD', country: 'US', origin: 'demo', transactions: chk.txs },
      { id: 'us-savings', name: 'Northwind Bank - Savings', currency: 'USD', country: 'US', origin: 'demo', transactions: sav.txs },
    ],
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
    projectedHousingPayment: 700,
    accounts: [
      { id: 'fr-courant', name: 'Banque Lumiere - Compte courant', currency: 'EUR', country: 'FR', origin: 'demo', transactions: cc.txs },
      { id: 'fr-livret', name: 'Banque Lumiere - Livret', currency: 'EUR', country: 'FR', origin: 'demo', transactions: liv.txs },
    ],
  };
}

export const DEMO_PERSONAS: (() => DemoPersona)[] = [usAlmostReady, frClean];

/** Exports an account as CSV so the import screen can be tested with the same data. */
export function accountToCsv(account: Account): string {
  const header = 'Date,Description,Amount';
  const lines = account.transactions
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((t) => `${t.date},"${t.rawLabel.replace(/"/g, '""')}",${t.amount.toFixed(2)}`);
  return [header, ...lines].join('\n');
}
