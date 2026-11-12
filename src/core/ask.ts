import { pl } from './text';
import { CATEGORIES, type Category, type Transaction } from './types';

/**
 * "Ask your statements". The model never sees a transaction: Gemini Nano only turns the
 * question into a small structured query (on the device); plain code runs the query on the
 * statements and writes the answer. The model cannot get a total wrong.
 */
export const INTENTS = ['total', 'count', 'list', 'monthly_average', 'largest'] as const;
export type Intent = (typeof INTENTS)[number];

export interface StatementQuery {
  intent: Intent;
  direction: 'in' | 'out' | 'any';
  categories: Category[];
  /** 'YYYY-MM', or empty for the whole period. */
  month: string;
  /** Words to look for in the labels, lower case; empty for none. */
  text: string;
}

export interface QueryAnswer {
  sentence: string;
  understood: string;
  transactions: Transaction[];
}

export const queryJsonSchema = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: [...INTENTS] },
    direction: { type: 'string', enum: ['in', 'out', 'any'] },
    categories: { type: 'array', items: { type: 'string', enum: [...CATEGORIES] } },
    month: { type: 'string' },
    text: { type: 'string' },
  },
  required: ['intent', 'direction', 'categories', 'month', 'text'],
} as const;

export function queryPrompt(question: string, months: string[]): string {
  return [
    'Turn a question about bank statements into a JSON query. Do not answer the question.',
    `intent: one of ${INTENTS.join(', ')}. direction: "in" for money received, "out" for money spent, "any".`,
    `categories: zero or more of ${CATEGORIES.join(', ')}. month: one of ${months.join(', ')}, or "" for all.`,
    'text: a merchant or word to find in the labels, lower case, or "".',
    'Examples:',
    'Q: How much did I spend on groceries in October? -> {"intent":"total","direction":"out","categories":["groceries"],"month":"2026-10","text":""}',
    'Q: Combien de frais bancaires ? -> {"intent":"total","direction":"out","categories":["overdraft_fee","nsf_fee"],"month":"","text":""}',
    'Q: Show my payments to Summit -> {"intent":"list","direction":"any","categories":[],"month":"","text":"summit"}',
    `Q: ${question.slice(0, 300)} ->`,
  ].join('\n');
}

/** Rejects anything outside the schema; the result is safe to run. */
export function sanitiseQuery(raw: unknown, months: string[]): StatementQuery | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!INTENTS.includes(r.intent as Intent)) return null;
  const direction = r.direction === 'in' || r.direction === 'out' ? r.direction : 'any';
  const categories = Array.isArray(r.categories)
    ? r.categories.filter((c): c is Category => CATEGORIES.includes(c as Category))
    : [];
  const month = typeof r.month === 'string' && months.includes(r.month) ? r.month : '';
  const text = typeof r.text === 'string' ? r.text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').trim().slice(0, 40) : '';
  return { intent: r.intent as Intent, direction, categories, month, text };
}

/** Small keyword fallback when no model is available. */
export function guessQuery(question: string, months: string[]): StatementQuery {
  const q = question.toLowerCase();
  const pick = (pairs: [RegExp, Category[]][]) => pairs.filter(([re]) => re.test(q)).flatMap(([, c]) => c);
  const categories = pick([
    [/fee|frais|overdraft|decouvert|découvert/, ['overdraft_fee', 'nsf_fee']],
    [/grocer|course|food|aliment/, ['groceries']],
    [/gambl|casino|bet|jeu|pari/, ['gambling']],
    [/rent|loyer|housing/, ['housing']],
    [/loan|debt|credit|prêt|pret/, ['loan_payment', 'bnpl', 'payday_loan']],
    [/salary|pay ?check|payroll|salaire|income|revenu/, ['income_salary', 'income_other']],
    [/subscription|abonnement/, ['subscriptions']],
    [/fuel|transport|essence/, ['transport']],
    [/zelle|venmo|paypal|p2p|person/, ['p2p_transfer']],
    [/cash deposit|espèces|especes/, ['cash_deposit']],
    [/refund|rembourse/, ['refund']],
    [/utilit|power|electric|energie|énergie|phone|mobile/, ['utilities']],
  ]);
  const intent: Intent = /how many|combien de fois|count/.test(q)
    ? 'count'
    : /largest|biggest|plus gros|plus grand/.test(q)
      ? 'largest'
      : /per month|par mois|average|moyenne/.test(q)
        ? 'monthly_average'
        : /show|list|which|quels|quelles|affiche/.test(q)
          ? 'list'
          : 'total';
  const direction = /earn|receive|income|salary|reçu|recu|gagn/.test(q) ? 'in' : /spend|spent|paid|pay |dépens|depens|payé/.test(q) ? 'out' : 'any';
  const monthNames = ['jan', 'feb|fév|fev', 'mar', 'apr|avr', 'may|mai', 'jun|juin', 'jul|juil', 'aug|août|aout', 'sep', 'oct', 'nov', 'dec|déc'];
  const month = months.find((m) => new RegExp(`\\b(${monthNames.at(Number(m.slice(5)) - 1)})`).test(q)) ?? '';
  return { intent, direction, categories, month, text: '' };
}

export function runQuery(query: StatementQuery, txs: Transaction[], currency: string, locale: string): QueryAnswer {
  const money = (n: number) => new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n);
  const matches = txs.filter(
    (t) =>
      !t.isInternalTransfer &&
      (query.direction === 'any' || (query.direction === 'in' ? t.amount > 0 : t.amount < 0)) &&
      (query.categories.length === 0 || (t.category && query.categories.includes(t.category))) &&
      (!query.month || t.date.startsWith(query.month)) &&
      (!query.text || t.rawLabel.toLowerCase().includes(query.text)),
  );
  const total = matches.reduce((s, t) => s + Math.abs(t.amount), 0);
  const months = new Set(txs.map((t) => t.date.slice(0, 7))).size || 1;
  const scope = [
    query.direction === 'in' ? 'money in' : query.direction === 'out' ? 'money out' : 'all lines',
    query.categories.length ? query.categories.join(', ').replace(/_/g, ' ') : '',
    query.text ? `labels containing "${query.text}"` : '',
    query.month ? `in ${query.month}` : 'over the whole period',
  ].filter(Boolean);
  const understood = `${query.intent.replace('_', ' ')} of ${scope.join(', ')}`;
  const sorted = matches.slice().sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  let sentence: string;
  switch (query.intent) {
    case 'count':
      sentence = `${pl(matches.length, 'transaction')}.`;
      break;
    case 'monthly_average':
      sentence = `${money(total / (query.month ? 1 : months))} per month on average (${pl(matches.length, 'transaction')}).`;
      break;
    case 'largest':
      sentence = sorted[0] ? `The largest is ${money(Math.abs(sorted[0].amount))} on ${sorted[0].date}: ${sorted[0].rawLabel}.` : 'No matching transaction.';
      break;
    case 'list':
      sentence = `${pl(matches.length, 'transaction')}, ${money(total)} in total.`;
      break;
    default:
      sentence = `${money(total)} in ${pl(matches.length, 'transaction')}.`;
  }
  if (matches.length === 0) sentence = 'No matching transaction in these statements.';
  return { sentence, understood, transactions: query.intent === 'largest' ? sorted.slice(0, 1) : sorted.slice(0, 50) };
}
