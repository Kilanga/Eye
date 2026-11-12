import { classifyByKeywords } from '../core/keywords';
import type { Category, Transaction } from '../core/types';
import type { EvalLine } from './dataset';
import { isUnsure } from '../core/clarify';

export interface EvalReport {
  lines: number;
  /** Share of lines the keyword rules answer on their own. */
  ruleCoverage: number;
  /** Of the lines the rules answer, the share they get right. */
  rulePrecision: number;
  /** Final accuracy (rules, then the model if given; unanswered lines count as "other"). */
  accuracy: number;
  /** Accuracy on the lines the rules could not answer: what the model adds. */
  accuracyOnRest: number;
  modelMs?: number;
  modelLines?: number;
  /** Lines the model answered wrongly. */
  modelWrong?: number;
  /** Of those, how many the app would turn into a question (low confidence or "other"). */
  modelWrongAsked?: number;
  mistakes: { label: string; truth: Category; got: Category; asked: boolean }[];
}

/** Classifies with the rules, then hands what is left to `model` (on-device Gemini Nano in the browser). */
export async function evaluate(
  set: EvalLine[],
  model?: (txs: Transaction[]) => Promise<void>,
): Promise<EvalReport> {
  const txs = set.map((l) => ({ ...l.tx, category: undefined, categorySource: undefined }) as Transaction);
  const rest: Transaction[] = [];
  for (const t of txs) {
    if (t.isInternalTransfer) {
      t.category = 'internal_transfer';
      t.categorySource = 'rule';
      continue;
    }
    const c = classifyByKeywords(t);
    if (c) {
      t.category = c;
      t.categorySource = 'rule';
    } else rest.push(t);
  }
  let modelMs: number | undefined;
  if (model && rest.length) {
    const t0 = performance.now();
    await model(rest);
    modelMs = performance.now() - t0;
  }
  const got = (t: Transaction): Category => t.category ?? 'other';
  const ruled = txs.map((t, i) => ({ t, truth: set[i].truth })).filter((x) => x.t.categorySource === 'rule');
  const restIds = new Set(rest.map((t) => t.id));
  const restPairs = txs.map((t, i) => ({ t, truth: set[i].truth })).filter((x) => restIds.has(x.t.id));
  const ok = (x: { t: Transaction; truth: Category }) => got(x.t) === x.truth;
  const all = txs.map((t, i) => ({ t, truth: set[i].truth }));
  const modelWrong = model ? restPairs.filter((x) => !ok(x)) : [];
  return {
    lines: txs.length,
    ruleCoverage: ruled.length / txs.length,
    rulePrecision: ruled.filter(ok).length / Math.max(ruled.length, 1),
    accuracy: all.filter(ok).length / txs.length,
    accuracyOnRest: restPairs.filter(ok).length / Math.max(restPairs.length, 1),
    modelMs,
    modelLines: model ? rest.length : undefined,
    modelWrong: model ? modelWrong.length : undefined,
    modelWrongAsked: model ? modelWrong.filter((x) => isUnsure(x.t)).length : undefined,
    mistakes: all
      .filter((x) => !ok(x))
      .map((x) => ({ label: x.t.rawLabel, truth: x.truth, got: got(x.t), asked: restIds.has(x.t.id) && isUnsure(x.t) })),
  };
}
