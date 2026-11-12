import type { RulePack } from './rules/types';
import type {
  Account,
  Analysis,
  Category,
  CheckId,
  CheckResult,
  CheckStatus,
  Metrics,
  Transaction,
  UserInputs,
} from './types';

/**
 * Turns classified transactions into the checks a lender runs.
 * Pure arithmetic: the model classifies, the code computes. Nothing here calls a model.
 */
export function analyze(accounts: Account[], pack: RulePack, inputs: UserInputs): Analysis {
  const all = accounts.flatMap((a) => a.transactions);
  const external = all.filter((t) => !t.isInternalTransfer);
  const months = new Set(all.map((t) => t.date.slice(0, 7)));
  const monthsCovered = Math.max(months.size, 1);

  const byCat = (...cats: Category[]) => external.filter((t) => t.category && cats.includes(t.category));
  const sum = (txs: Transaction[]) => txs.reduce((s, t) => s + t.amount, 0);

  const salaryTxs = byCat('income_salary').filter((t) => t.amount > 0);
  const monthlySalary = sum(salaryTxs) / monthsCovered;
  const monthlyIncome = sum(byCat('income_salary', 'income_other').filter((t) => t.amount > 0)) / monthsCovered;
  const incomeBase =
    pack.incomeBasis === 'gross' ? inputs.grossMonthlyIncome ?? monthlySalary : monthlySalary;

  const debtTxs = byCat('loan_payment', 'bnpl').filter((t) => t.amount < 0);
  const monthlyDebtPayments = Math.abs(sum(debtTxs)) / monthsCovered;
  const debtRatio =
    incomeBase > 0 ? (monthlyDebtPayments + inputs.projectedHousingPayment) / incomeBase : Infinity;

  const overdraftTxs = byCat('overdraft_fee');
  const nsfTxs = byCat('nsf_fee');
  const negativeBalanceTxs = all.filter((t) => t.balance !== undefined && t.balance < 0);
  const gamblingTxs = byCat('gambling');
  const paydayTxs = byCat('payday_loan');

  const share = pack.largeDepositShareOfMonthlyIncome;
  const largeDepositTxs =
    share !== undefined && monthlySalary > 0
      ? external.filter(
          (t) =>
            t.amount > share * monthlySalary &&
            t.category !== 'income_salary' &&
            t.category !== 'internal_transfer',
        )
      : [];

  const savingsMonthSet = new Set(
    all
      .filter((t) => t.amount < 0 && (t.category === 'savings' || t.isInternalTransfer))
      .map((t) => t.date.slice(0, 7)),
  );

  const metrics: Metrics = {
    monthsCovered,
    monthlyIncome: round2(monthlyIncome),
    monthlySalary: round2(monthlySalary),
    incomeBase: round2(incomeBase),
    monthlyDebtPayments: round2(monthlyDebtPayments),
    debtRatio: Number.isFinite(debtRatio) ? round4(debtRatio) : debtRatio,
    overdraftFeeCount: overdraftTxs.length,
    nsfCount: nsfTxs.length,
    gamblingCount: gamblingTxs.length,
    gamblingMonthly: round2(Math.abs(sum(gamblingTxs)) / monthsCovered),
    paydayCount: paydayTxs.length,
    largeDepositCount: largeDepositTxs.length,
    largeDepositTotal: round2(sum(largeDepositTxs)),
    savingsMonths: savingsMonthSet.size,
  };

  const fmtMoney = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: pack.currency, maximumFractionDigits: 0 }).format(n);
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  const builders: Record<CheckId, () => CheckResult> = {
    statement_coverage: () => ({
      id: 'statement_coverage',
      status: monthsCovered >= pack.statementMonths ? 'ok' : 'watch',
      title: 'Statement coverage',
      detail: `${monthsCovered} month(s) imported; lenders usually ask for ${pack.statementMonths}, for every account.`,
      transactionIds: [],
    }),
    debt_ratio: () => {
      const r = pack.debtRatio;
      const status: CheckStatus = debtRatio <= r.comfort ? 'ok' : debtRatio <= r.max ? 'watch' : 'alert';
      return {
        id: 'debt_ratio',
        status,
        title: r.label,
        detail: Number.isFinite(debtRatio)
          ? `${pct(debtRatio)} with the target payment of ${fmtMoney(inputs.projectedHousingPayment)}. Comfortable up to ${pct(r.comfort)}, limit around ${pct(r.max)}.`
          : 'No income detected: add your income to compute the ratio.',
        transactionIds: debtTxs.map((t) => t.id),
      };
    },
    overdraft: () => {
      const n = overdraftTxs.length + nsfTxs.length;
      const status: CheckStatus = n === 0 && negativeBalanceTxs.length === 0 ? 'ok' : n >= 2 ? 'alert' : 'watch';
      return {
        id: 'overdraft',
        status,
        title: 'Overdrafts and returned payments',
        detail:
          n === 0 && negativeBalanceTxs.length === 0
            ? 'No overdraft fee or returned payment in the period.'
            : `${overdraftTxs.length} overdraft fee(s), ${nsfTxs.length} returned payment(s), ${negativeBalanceTxs.length} negative balance line(s).`,
        transactionIds: [...overdraftTxs, ...nsfTxs, ...negativeBalanceTxs].map((t) => t.id),
      };
    },
    large_deposits: () => ({
      id: 'large_deposits',
      status: largeDepositTxs.length === 0 ? 'ok' : 'watch',
      title: 'Large deposits to explain',
      detail:
        largeDepositTxs.length === 0
          ? 'No non-salary deposit above the threshold.'
          : `${largeDepositTxs.length} deposit(s) above ${Math.round((share ?? 0) * 100)}% of monthly income: the lender will ask where the money came from.`,
      transactionIds: largeDepositTxs.map((t) => t.id),
    }),
    gambling: () => {
      const heavy = gamblingTxs.length >= 3 || (monthlyIncome > 0 && metrics.gamblingMonthly / monthlyIncome > 0.02);
      return {
        id: 'gambling',
        status: gamblingTxs.length === 0 ? 'ok' : heavy ? 'alert' : 'watch',
        title: 'Gambling transactions',
        detail:
          gamblingTxs.length === 0
            ? 'None in the period.'
            : `${gamblingTxs.length} transaction(s), about ${fmtMoney(metrics.gamblingMonthly)} per month. Lenders notice even small amounts.`,
        transactionIds: gamblingTxs.map((t) => t.id),
      };
    },
    payday_loans: () => ({
      id: 'payday_loans',
      status: paydayTxs.length === 0 ? 'ok' : 'alert',
      title: 'Short-term high-cost credit',
      detail: paydayTxs.length === 0 ? 'None in the period.' : `${paydayTxs.length} payday or quick-loan transaction(s).`,
      transactionIds: paydayTxs.map((t) => t.id),
    }),
    savings_regularity: () => ({
      id: 'savings_regularity',
      status: savingsMonthSet.size >= monthsCovered ? 'ok' : 'watch',
      title: 'Regular savings',
      detail: `Money set aside in ${savingsMonthSet.size} of ${monthsCovered} month(s). Small but regular beats large and occasional.`,
      transactionIds: [],
    }),
  };

  return { country: pack.country, metrics, checks: pack.checks.map((id) => builders[id]()) };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
