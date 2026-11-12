import { HybridAI } from './ai/models';
import { analyze } from './core/analyze';
import { applyPersonalRules, type PersonalRules } from './core/clarify';
import { applyKeywordRules } from './core/keywords';
import type { RulePack } from './core/rules';
import { matchInternalTransfers } from './core/transfers';
import type { Account, Analysis, CategorySource, UserInputs } from './core/types';

export interface PipelineResult extends Analysis {
  /** Who classified how many lines: the hybrid split, shown to the user. */
  sources: Record<CategorySource, number>;
  notes: string[];
}

export interface PipelineProgress {
  stage: 'transfers' | 'rules' | 'model' | 'analysis';
  done?: number;
  total?: number;
}

/**
 * 1. match transfers between the user's own accounts (code)
 * 2. classify obvious lines with keyword rules (code)
 * 3. apply the user's own answers (personal rules, on the device)
 * 4. classify the rest with Gemini Nano (on device; demo data may fall back to the cloud)
 * 5. compute the lender's checks with the country rule pack (code)
 */
export async function runPipeline(
  accounts: Account[],
  pack: RulePack,
  inputs: UserInputs,
  ai: HybridAI | null,
  onProgress: (p: PipelineProgress) => void = () => {},
  learning: { rules?: PersonalRules; examples?: { label: string; amount: number; category: string; origin: 'user' | 'demo' }[] } = {},
): Promise<PipelineResult> {
  const notes: string[] = [];
  const all = accounts.flatMap((a) => a.transactions);
  all.forEach((t) => {
    delete t.category;
    delete t.categorySource;
    delete t.categoryConfidence;
    delete t.isInternalTransfer;
  });

  onProgress({ stage: 'transfers' });
  matchInternalTransfers(accounts);

  onProgress({ stage: 'rules' });
  const afterRules = applyKeywordRules(all);
  await applyPersonalRules(afterRules, learning.rules ?? {});
  const remaining = afterRules.filter((t) => !t.category);

  if (ai && remaining.length > 0) {
    // Group by origin so user data and demo data never share a model call.
    for (const origin of ['user', 'demo'] as const) {
      const ids = new Set(accounts.filter((a) => a.origin === origin).map((a) => a.id));
      const txs = remaining.filter((t) => ids.has(t.accountId));
      if (!txs.length) continue;
      if (origin === 'user' && (await HybridAI.onDeviceStatus()) !== 'available') {
        // Never fall back to the cloud for real statements: keep the rules' answer and say so.
        txs.forEach((t) => {
          t.category = 'other';
          t.categorySource = 'unclassified';
        });
        notes.push(
          `Gemini Nano is not ready on this computer, so ${txs.length === 1 ? 'one line' : `${txs.length} lines`} the built-in rules could not read ${txs.length === 1 ? 'stays' : 'stay'} unrecognised. Answer the questions below, or download the on-device model and review again.`,
        );
        continue;
      }
      try {
        // The user's answers guide the model, never crossing origins (user answers only in on-device prompts).
        const examples = (learning.examples ?? []).filter((e) => e.origin === origin);
        await ai.classifyTransactions(txs, origin, (done, total) => onProgress({ stage: 'model', done, total }), examples);
      } catch (err) {
        // A model failure (network, quota, model not ready) must never stop the analysis:
        // the rules' answer stands and the user is told.
        txs.filter((t) => !t.category).forEach((t) => {
          t.category = 'other';
          t.categorySource = 'unclassified';
        });
        notes.push(modelFailureNote(txs.length, err));
      }
    }
  } else {
    remaining.forEach((t) => {
      t.category = 'other';
      t.categorySource = 'unclassified';
    });
  }

  onProgress({ stage: 'analysis' });
  const sources: Record<CategorySource, number> = { rule: 0, user: 0, on_device: 0, in_cloud: 0, unclassified: 0 };
  all.forEach((t) => sources[t.categorySource ?? 'unclassified']++);
  return { ...analyze(accounts, pack, inputs), sources, notes };
}

/** A plain sentence for the user when the model could not read some lines: never the raw SDK error. */
export function modelFailureNote(count: number, err: unknown): string {
  const lines = count === 1 ? 'One line was' : `${count} lines were`;
  const m = String((err as Error)?.message ?? err);
  const offline = (typeof navigator !== 'undefined' && navigator.onLine === false) || /Failed to fetch|NetworkError|network error|ERR_INTERNET_DISCONNECTED/i.test(m);
  const why = offline
    ? 'You are offline, and without Gemini Nano on this computer the sample files need the cloud model.'
    : /\b(429|500|502|503|504)\b|overloaded|high demand|quota|exhausted/i.test(m)
      ? 'The cloud model is busy right now.'
      : 'The model did not answer.';
  return `${lines} not read by a model. ${why} The built-in rules' answer is shown, and the app asks you about the lines that matter.`;
}
