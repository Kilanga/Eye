import type { RulePack } from './rules/types';
import type { Analysis, CheckId, CheckStatus, UserInputs } from './types';

/**
 * The 90-day plan is built in two halves.
 *
 *  1. Here, on the device, plain code decides WHICH levers apply, WHEN, and computes the exact
 *     figures (for example: "141 per month less in debt payments reaches 36%").
 *  2. The cloud model only rewrites the wording. It receives the lever ids, never the figures,
 *     and must use {{placeholders}}; the figures are filled in here afterwards.
 *
 * The model therefore cannot get a number wrong, and the plan still works with no network.
 */

export const LEVER_IDS = [
  'complete_statements',
  'reduce_debt_payments',
  'overdraft_buffer',
  'document_deposits',
  'stop_gambling',
  'exit_short_term_credit',
  'regular_savings',
  'review_obligations',
  'document_cash',
  'refresh_statements',
  'build_funds',
] as const;
export type LeverId = (typeof LEVER_IDS)[number];

const LEVER_FOR_CHECK: Record<CheckId, LeverId> = {
  statement_coverage: 'complete_statements',
  debt_ratio: 'reduce_debt_payments',
  overdraft: 'overdraft_buffer',
  large_deposits: 'document_deposits',
  gambling: 'stop_gambling',
  payday_loans: 'exit_short_term_credit',
  savings_regularity: 'regular_savings',
  recurring_obligations: 'review_obligations',
  cash_deposits: 'document_cash',
  statement_recency: 'refresh_statements',
  funds_to_close: 'build_funds',
};

const WEEK: Record<LeverId, number> = {
  complete_statements: 1,
  overdraft_buffer: 1,
  stop_gambling: 1,
  exit_short_term_credit: 1,
  document_deposits: 1,
  regular_savings: 2,
  reduce_debt_payments: 2,
  review_obligations: 1,
  document_cash: 1,
  refresh_statements: 1,
  build_funds: 2,
};

/** The placeholders each lever may use. Anything else in the model's wording is rejected. */
export const LEVER_PLACEHOLDERS: Record<LeverId, readonly string[]> = {
  complete_statements: ['months_covered', 'months_required'],
  reduce_debt_payments: ['current_ratio', 'target_ratio', 'monthly_reduction', 'max_housing_payment'],
  overdraft_buffer: ['overdraft_events'],
  document_deposits: ['large_deposit_count', 'large_deposit_total'],
  stop_gambling: ['gambling_count', 'gambling_monthly'],
  exit_short_term_credit: ['payday_count'],
  regular_savings: ['savings_months', 'months_required'],
  review_obligations: ['obligations_pending'],
  document_cash: ['cash_count', 'cash_total'],
  refresh_statements: ['statement_age_days', 'freshness_days'],
  build_funds: ['funds_gap', 'cash_to_close'],
};

/** Default wording, used offline or whenever the model's wording fails validation. */
export const DEFAULT_TEXT: Record<LeverId, { action: string; why: string }> = {
  complete_statements: {
    action: 'Download the missing statements so you have {{months_required}} full months for every account (you have {{months_covered}}).',
    why: 'An incomplete file is the first thing that delays an application.',
  },
  reduce_debt_payments: {
    action: 'Cut {{monthly_reduction}} per month from debt payments, or aim for housing at or below {{max_housing_payment}}.',
    why: 'Your ratio is {{current_ratio}}; at {{target_ratio}} or less you sit in the comfortable zone.',
  },
  overdraft_buffer: {
    action: 'Set an automatic transfer from savings when the balance runs low, and turn on low-balance alerts.',
    why: '{{overdraft_events}} overdraft event(s) are visible; every clean month replaces one.',
  },
  document_deposits: {
    action: 'Gather proof of where the money came from for the {{large_deposit_count}} large deposit(s), {{large_deposit_total}} in total.',
    why: 'Underwriters ask for a paper trail on every unexplained deposit; having it ready saves weeks.',
  },
  stop_gambling: {
    action: 'Stop gambling payments from the accounts you will show (about {{gambling_monthly}} per month today).',
    why: '{{gambling_count}} gambling line(s) are visible, and lenders notice even small amounts.',
  },
  exit_short_term_credit: {
    action: 'Repay and close the short-term loans before the statements you will submit begin.',
    why: '{{payday_count}} quick-loan line(s) read as a cash-flow warning.',
  },
  review_obligations: {
    action: 'Tell the app which of the {{obligations_pending}} recurring payment(s) are credit, and keep the contracts at hand.',
    why: 'Lenders count instalment plans and leases as debt even when the statement does not say loan.',
  },
  document_cash: {
    action: 'Stop depositing cash before you apply, and note where the {{cash_count}} cash deposit(s) ({{cash_total}}) came from.',
    why: 'Cash cannot be traced, so lenders may leave it out of the funds you can use.',
  },
  refresh_statements: {
    action: 'Download the latest statements of every account, every page, with no missing month.',
    why: 'Your last line is {{statement_age_days}} days old; lenders want statements within {{freshness_days}} days of the application.',
  },
  build_funds: {
    action: 'Set aside the {{funds_gap}} still missing, in an account you will show, at least two statements before you apply.',
    why: 'Lenders verify the {{cash_to_close}} needed at closing in your statements; recent large deposits would need sourcing.',
  },
  regular_savings: {
    action: 'Set up a standing monthly transfer to savings, even a small one.',
    why: 'Savings show in {{savings_months}} of {{months_required}} months; regular beats large and occasional.',
  },
};

export interface PlanStep {
  week: number;
  checkId: CheckId;
  status: CheckStatus;
  lever: LeverId;
  /** Exact, formatted figures. Never sent anywhere. */
  values: Record<string, string>;
}

export interface DraftPlan {
  country: string;
  steps: PlanStep[];
  /** From this week on, every statement is one the lender will read. */
  cleanFromWeek: number;
}

export interface FinalStep extends PlanStep {
  action: string;
  why: string;
  wording: 'cloud' | 'local';
}

export interface FinalPlan {
  summary: string;
  summaryWording: 'cloud' | 'local';
  steps: FinalStep[];
  cleanFromWeek: number;
}

/** What the cloud model is told about a step: enums only. */
export interface CloudStep {
  week: number;
  checkId: CheckId;
  lever: LeverId;
}

/** Cloud answer: wording per step, by index. */
export interface PlanWording {
  summary?: string;
  steps?: { i?: number; action?: string; why?: string }[];
}

export function buildDraftPlan(analysis: Analysis, pack: RulePack, inputs: UserInputs): DraftPlan {
  const m = analysis.metrics;
  const money = (n: number) =>
    new Intl.NumberFormat(pack.locale, { style: 'currency', currency: pack.currency, maximumFractionDigits: 0 }).format(n);
  const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

  const valuesFor = (lever: LeverId): Record<string, string> => {
    switch (lever) {
      case 'complete_statements':
        return { months_covered: String(m.monthsCovered), months_required: String(pack.statementMonths) };
      case 'reduce_debt_payments': {
        const maxTotal = pack.debtRatio.comfort * m.incomeBase;
        const current = m.monthlyDebtPayments + inputs.projectedHousingPayment;
        return {
          current_ratio: Number.isFinite(m.debtRatio) ? pct(m.debtRatio) : 'not computable',
          target_ratio: pct(pack.debtRatio.comfort),
          monthly_reduction: money(Math.max(0, Math.ceil(current - maxTotal))),
          max_housing_payment: money(Math.max(0, Math.floor(maxTotal - m.monthlyDebtPayments))),
        };
      }
      case 'overdraft_buffer':
        return { overdraft_events: String(m.overdraftFeeCount + m.nsfCount) };
      case 'document_deposits':
        return { large_deposit_count: String(m.largeDepositCount), large_deposit_total: money(m.largeDepositTotal) };
      case 'stop_gambling':
        return { gambling_count: String(m.gamblingCount), gambling_monthly: money(m.gamblingMonthly) };
      case 'exit_short_term_credit':
        return { payday_count: String(m.paydayCount) };
      case 'regular_savings':
        return { savings_months: String(m.savingsMonths), months_required: String(m.monthsCovered) };
      case 'review_obligations':
        return { obligations_pending: String(m.obligationsPending) };
      case 'document_cash':
        return { cash_count: String(m.cashDepositCount), cash_total: money(m.cashDepositTotal) };
      case 'refresh_statements':
        return { statement_age_days: String(m.statementAgeDays), freshness_days: String(pack.freshnessDays ?? 45) };
      case 'build_funds':
        return {
          funds_gap: money(Math.max(0, (inputs.cashToClose ?? 0) - (m.availableFunds ?? 0))),
          cash_to_close: money(inputs.cashToClose ?? 0),
        };
    }
  };
  const rank: Record<CheckStatus, number> = { alert: 0, watch: 1, ok: 2 };
  const steps = analysis.checks
    .filter((c) => c.status !== 'ok')
    .sort((a, b) => rank[a.status] - rank[b.status])
    .map((c) => {
      const lever = LEVER_FOR_CHECK[c.id];
      return { week: WEEK[lever], checkId: c.id, status: c.status, lever, values: valuesFor(lever) };
    })
    .sort((a, b) => a.week - b.week);

  return {
    country: analysis.country,
    steps,
    // 12 weeks in total; the last N months of statements are what the lender reads.
    cleanFromWeek: Math.max(1, 13 - pack.statementMonths * 4),
  };
}

export function toCloudSteps(draft: DraftPlan): CloudStep[] {
  return draft.steps.map(({ week, checkId, lever }) => ({ week, checkId, lever }));
}

const PLACEHOLDER = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

/** Rejects wording that writes its own numbers or uses a placeholder the lever does not own. */
export function isValidWording(text: unknown, allowed: readonly string[]): text is string {
  if (typeof text !== 'string' || text.trim() === '' || text.length > 300) return false;
  const withoutPlaceholders = text.replace(PLACEHOLDER, '');
  if (/\d/.test(withoutPlaceholders)) return false;
  return [...text.matchAll(PLACEHOLDER)].every((m) => allowed.includes(m[1]));
}

function fill(text: string, values: Record<string, string>): string {
  return text.replace(PLACEHOLDER, (whole, key: string) => values[key] ?? whole);
}

const DEFAULT_SUMMARY_ALL_OK =
  'Every check is green. Keep the next statements as clean as these, then apply.';
const DEFAULT_SUMMARY =
  'Fix the red lights first, then keep every new statement clean: those are the months the lender will read.';

/** Merges the (optional) cloud wording into the local draft and fills in the real figures. */
export function finalisePlan(draft: DraftPlan, wording?: PlanWording): FinalPlan {
  const byIndex = new Map((wording?.steps ?? []).map((s) => [s.i, s]));
  const steps: FinalStep[] = draft.steps.map((step, i) => {
    const allowed = LEVER_PLACEHOLDERS[step.lever];
    const w = byIndex.get(i);
    const cloudOk = w && isValidWording(w.action, allowed) && isValidWording(w.why, allowed);
    const text = cloudOk ? { action: w!.action!, why: w!.why! } : DEFAULT_TEXT[step.lever];
    return {
      ...step,
      action: fill(text.action, step.values),
      why: fill(text.why, step.values),
      wording: cloudOk ? 'cloud' : 'local',
    };
  });
  const summaryOk = isValidWording(wording?.summary, []);
  return {
    summary: summaryOk ? wording!.summary! : draft.steps.length ? DEFAULT_SUMMARY : DEFAULT_SUMMARY_ALL_OK,
    summaryWording: summaryOk ? 'cloud' : 'local',
    steps,
    cleanFromWeek: draft.cleanFromWeek,
  };
}
