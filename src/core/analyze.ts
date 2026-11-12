import { isModelGuess } from './clarify';
import { pl } from './text';
import { findRecurringObligations, isCounted } from './recurring';
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
  // Bank statement loans: every external deposit counts except transfers, refunds, loan
  // proceeds and peer-to-peer payments, averaged per month, net of the expense ratio.
  const INELIGIBLE: Category[] = ['internal_transfer', 'refund', 'p2p_transfer', 'payday_loan', 'loan_payment', 'bnpl'];
  const eligibleDeposits = external.filter((t) => t.amount > 0 && !(t.category && INELIGIBLE.includes(t.category)));
  const expenseRatio =
    inputs.expenseRatio ?? (inputs.accountKind === 'personal' ? 0 : pack.defaultExpenseRatio ?? 0);
  const eligibleDepositsMonthly = (sum(eligibleDeposits) / monthsCovered) * (1 - expenseRatio);
  const incomeBase =
    pack.incomeBasis === 'deposits'
      ? eligibleDepositsMonthly
      : pack.incomeBasis === 'gross'
        ? inputs.grossMonthlyIncome ?? monthlySalary
        : monthlySalary;

  const obligations = findRecurringObligations(external).map((c) => ({
    ...c,
    counted: isCounted(c, inputs.obligationDecisions),
  }));
  const obligationsMonthly = obligations.filter((o) => o.counted).reduce((s, o) => s + o.monthlyAmount, 0);
  const obligationsPending = obligations.filter((o) => !inputs.obligationDecisions?.[o.key]).length;

  const debtTxs = byCat('loan_payment', 'bnpl').filter((t) => t.amount < 0);
  const monthlyDebtPayments = Math.abs(sum(debtTxs)) / monthsCovered + obligationsMonthly;
  const debtRatio =
    incomeBase > 0 ? (monthlyDebtPayments + inputs.projectedHousingPayment) / incomeBase : Infinity;

  const overdraftTxs = byCat('overdraft_fee');
  const nsfTxs = byCat('nsf_fee');
  const negativeBalanceTxs = all.filter((t) => t.balance !== undefined && t.balance < 0);
  const gamblingTxs = byCat('gambling');
  const paydayTxs = byCat('payday_loan');

  const share = pack.largeDepositShareOfMonthlyIncome;
  const largeDepositTxs =
    // Fannie Mae B3-4.2-02: a large deposit exceeds 50% of the total monthly *qualifying* income.
    share !== undefined && incomeBase > 0
      ? external.filter(
          (t) =>
            t.amount > share * incomeBase &&
            // A model's guess never clears a check: only the rules or the user can say it is pay.
            (isModelGuess(t) || (t.category !== 'income_salary' && t.category !== 'internal_transfer')) &&
            // For self-employed borrowers, client payments are the income itself.
            !(pack.incomeBasis === 'deposits' && t.category === 'income_other'),
        )
      : [];

  const cashTxs = byCat('cash_deposit').filter((t) => t.amount > 0);

  // Statements must be recent (US: dated within 45 days of the application) and continuous.
  const lastDate = all.reduce((m, t) => (t.date > m ? t.date : m), '');
  const reference = inputs.applicationDate ?? new Date().toISOString().slice(0, 10);
  const statementAgeDays = lastDate ? Math.max(0, Math.round((Date.parse(reference) - Date.parse(lastDate)) / 864e5)) : 0;
  const gaps = accounts.flatMap((a) => {
    const ms = [...new Set(a.transactions.map((t) => t.date.slice(0, 7)))].sort();
    const missing: string[] = [];
    for (let i = 1; i < ms.length; i++) {
      const [y0, m0] = ms[i - 1].split('-').map(Number);
      const [y1, m1] = ms[i].split('-').map(Number);
      for (let k = (y1 - y0) * 12 + (m1 - m0) - 1; k > 0; k--) missing.push(`${a.name}: a month before ${ms[i]}`);
    }
    return missing;
  });

  // Funds: the latest known balance of each account, when the files carry balances.
  const latestBalances = accounts
    .map((a) => a.transactions.filter((t) => t.balance !== undefined).sort((x, y) => x.date.localeCompare(y.date)).at(-1)?.balance)
    .filter((b): b is number => b !== undefined);
  const availableFunds = latestBalances.length ? latestBalances.reduce((s, b) => s + b, 0) : undefined;

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
    obligationsMonthly: round2(obligationsMonthly),
    obligationsPending,
    cashDepositCount: cashTxs.length,
    cashDepositTotal: round2(sum(cashTxs)),
    statementAgeDays,
    ...(availableFunds !== undefined ? { availableFunds: round2(availableFunds) } : {}),
    ...(pack.incomeBasis === 'deposits' ? { eligibleDepositsMonthly: round2(eligibleDepositsMonthly) } : {}),
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
      detail: `${pl(monthsCovered, 'month')} of statements; lenders usually ask for ${pack.statementMonths}, for every account.`,
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
            : [pl(overdraftTxs.length, 'overdraft fee'), pl(nsfTxs.length, 'returned payment'), pl(negativeBalanceTxs.length, 'day', 'days') + ' with a negative balance'].filter((x) => !x.startsWith('0 ')).join(', ') + '.',
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
          : `${pl(largeDepositTxs.length, 'deposit')} above ${Math.round((share ?? 0) * 100)}% of monthly qualifying income (${fmtMoney((share ?? 0) * incomeBase)}): the lender will ask where the money came from.`,
      transactionIds: largeDepositTxs.map((t) => t.id),
    }),
    gambling: () => {
      const heavy = gamblingTxs.length >= 3 || (monthlyIncome > 0 && metrics.gamblingMonthly / monthlyIncome > 0.02);
      return {
        id: 'gambling',
        status: gamblingTxs.length === 0 ? 'ok' : heavy ? 'alert' : 'watch',
        title: 'Gambling',
        detail:
          gamblingTxs.length === 0
            ? 'None in the period.'
            : `${pl(gamblingTxs.length, 'gambling payment')}, about ${fmtMoney(metrics.gamblingMonthly)} per month. Lenders notice even small amounts.`,
        transactionIds: gamblingTxs.map((t) => t.id),
      };
    },
    payday_loans: () => ({
      id: 'payday_loans',
      status: paydayTxs.length === 0 ? 'ok' : 'alert',
      title: 'Payday and quick loans',
      detail: paydayTxs.length === 0 ? 'None in the period.' : `${pl(paydayTxs.length, 'payday or quick-loan payment')}.`,
      transactionIds: paydayTxs.map((t) => t.id),
    }),
    recurring_obligations: () => ({
      id: 'recurring_obligations',
      status: obligationsPending === 0 ? 'ok' : 'watch',
      title: 'Regular payments that may be debts',
      detail:
        obligations.length === 0
          ? 'No recurring payment that looks like hidden credit.'
          : obligationsPending === 0
            ? `${pl(obligations.length, 'regular payment')} reviewed; ${fmtMoney(obligationsMonthly)} per month counted as debt.`
            : `${pl(obligationsPending, 'regular payment')} a lender may count as debt. Say below what each one is.`,
      transactionIds: obligations.flatMap((o) => o.transactionIds),
    }),
    cash_deposits: () => ({
      id: 'cash_deposits',
      status: cashTxs.length === 0 ? 'ok' : 'watch',
      title: 'Cash deposits',
      detail: cashTxs.length
        ? `${pl(cashTxs.length, 'cash deposit')}, ${fmtMoney(metrics.cashDepositTotal)} in total. Cash cannot be traced: lenders may not count it toward the funds you need.`
        : 'No cash deposit in the period.',
      transactionIds: cashTxs.map((t) => t.id),
    }),
    statement_recency: () => {
      const limit = pack.freshnessDays ?? 45;
      const status: CheckStatus = statementAgeDays > limit ? 'alert' : gaps.length ? 'watch' : 'ok';
      return {
        id: 'statement_recency',
        status,
        title: 'Recent and complete statements',
        detail:
          statementAgeDays > limit
            ? `The last line is ${statementAgeDays} days old; statements must be dated within ${limit} days of the application. Download the latest ones.`
            : gaps.length
              ? `Missing: ${gaps.slice(0, 3).join('; ')}. Lenders want consecutive statements, every page.`
              : `No missing month; the last line is ${pl(statementAgeDays, 'day')} old.`,
        transactionIds: [],
      };
    },
    funds_to_close: () => {
      const need = inputs.cashToClose ?? 0;
      const monthlyHousing = inputs.projectedHousingPayment || 1;
      if (availableFunds === undefined) {
        return {
          id: 'funds_to_close',
          status: 'watch',
          title: 'Funds to close and reserves',
          detail: `You need ${fmtMoney(need)} at closing, but these files carry no balance. Add statements with a balance column (most PDFs have one).`,
          transactionIds: [],
        };
      }
      const left = availableFunds - need;
      const reserves = left / monthlyHousing;
      return {
        id: 'funds_to_close',
        status: left < 0 ? 'alert' : reserves < 2 ? 'watch' : 'ok',
        title: 'Funds to close and reserves',
        detail:
          left < 0
            ? `Balances total ${fmtMoney(availableFunds)}; ${fmtMoney(-left)} short of the ${fmtMoney(need)} needed at closing.`
            : `Balances total ${fmtMoney(availableFunds)}: after ${fmtMoney(need)} at closing, ${reserves.toFixed(1)} months of housing payments remain in reserve. Three or more is a recognised strength.`,
        transactionIds: [],
      };
    },
    savings_regularity: () => ({
      id: 'savings_regularity',
      status: savingsMonthSet.size >= monthsCovered ? 'ok' : 'watch',
      title: 'Regular savings',
      detail: `Money set aside in ${savingsMonthSet.size} of ${pl(monthsCovered, 'month')}. Small but regular beats large and occasional.`,
      transactionIds: [],
    }),
  };

  const checks = pack.checks
    // Funds are only checked when the user says how much is needed at closing.
    .filter((id) => id !== 'funds_to_close' || (inputs.cashToClose ?? 0) > 0)
    .map((id) => {
      const c = builders[id]();
      const note = pack.checkNotes?.[id];
      return note && c.status !== 'ok' ? { ...c, detail: `${c.detail} ${note}` } : c;
    });
  return { country: pack.country, program: pack.program, metrics, checks, obligations };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
