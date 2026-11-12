import type { Analysis, CheckId, CheckStatus, CountryCode } from './types';

/**
 * The ONLY thing that leaves the device.
 *
 * A handful of rounded numbers and enums: no transaction, no label, no name, no exact
 * amount. Income and payment are bucketed so the profile cannot be matched back to a
 * statement. The cloud model writes a plan and a letter template from this alone.
 */
export interface CloudProfile {
  country: CountryCode;
  monthsCovered: number;
  /** Lower bound of a 500-wide bucket, in the pack currency. */
  incomeBucket: number;
  /** Lower bound of a 250-wide bucket. */
  housingPaymentBucket: number;
  /** Debt ratio as a whole percentage. */
  debtRatioPct: number;
  overdraftEvents: number;
  largeDeposits: number;
  gamblingTransactions: number;
  paydayTransactions: number;
  savingsMonths: number;
  checks: { id: CheckId; status: CheckStatus }[];
}

export const PROFILE_KEYS: readonly (keyof CloudProfile)[] = [
  'country',
  'monthsCovered',
  'incomeBucket',
  'housingPaymentBucket',
  'debtRatioPct',
  'overdraftEvents',
  'largeDeposits',
  'gamblingTransactions',
  'paydayTransactions',
  'savingsMonths',
  'checks',
] as const;

export function buildCloudProfile(analysis: Analysis, projectedHousingPayment: number): CloudProfile {
  const m = analysis.metrics;
  return {
    country: analysis.country,
    monthsCovered: m.monthsCovered,
    incomeBucket: bucket(m.incomeBase, 500),
    housingPaymentBucket: bucket(projectedHousingPayment, 250),
    debtRatioPct: Number.isFinite(m.debtRatio) ? Math.round(m.debtRatio * 100) : -1,
    overdraftEvents: m.overdraftFeeCount + m.nsfCount,
    largeDeposits: m.largeDepositCount,
    gamblingTransactions: m.gamblingCount,
    paydayTransactions: m.paydayCount,
    savingsMonths: m.savingsMonths,
    checks: analysis.checks.map((c) => ({ id: c.id, status: c.status })),
  };
}

function bucket(n: number, width: number): number {
  return Math.max(0, Math.floor(n / width) * width);
}
