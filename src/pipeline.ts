import { HybridAI } from './ai/models';
import { analyze } from './core/analyze';
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
 * 3. classify the rest with Gemini Nano (on device; demo data may fall back to the cloud)
 * 4. compute the lender's checks with the country rule pack (code)
 */
export async function runPipeline(
  accounts: Account[],
  pack: RulePack,
  inputs: UserInputs,
  ai: HybridAI | null,
  onProgress: (p: PipelineProgress) => void = () => {},
): Promise<PipelineResult> {
  const notes: string[] = [];
  const all = accounts.flatMap((a) => a.transactions);
  all.forEach((t) => {
    delete t.category;
    delete t.categorySource;
    delete t.isInternalTransfer;
  });

  onProgress({ stage: 'transfers' });
  matchInternalTransfers(accounts);

  onProgress({ stage: 'rules' });
  const remaining = applyKeywordRules(all);

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
          `Gemini Nano is not ready on this device, so ${txs.length} line(s) the rules could not read stay unclassified. Prepare private mode and run the analysis again for a sharper result.`,
        );
        continue;
      }
      try {
        await ai.classifyTransactions(txs, origin, (done, total) => onProgress({ stage: 'model', done, total }));
      } catch (err) {
        // A model failure (network, quota, model not ready) must never stop the analysis:
        // the rules' answer stands and the user is told.
        txs.filter((t) => !t.category).forEach((t) => {
          t.category = 'other';
          t.categorySource = 'unclassified';
        });
        notes.push(`The model could not classify ${txs.length} line(s) (${(err as Error).message.slice(0, 120)}). The rules' answer is shown.`);
      }
    }
  } else {
    remaining.forEach((t) => {
      t.category = 'other';
      t.categorySource = 'unclassified';
    });
  }

  onProgress({ stage: 'analysis' });
  const sources: Record<CategorySource, number> = { rule: 0, on_device: 0, in_cloud: 0, unclassified: 0 };
  all.forEach((t) => sources[t.categorySource ?? 'unclassified']++);
  return { ...analyze(accounts, pack, inputs), sources, notes };
}
