import type { HybridAI } from './ai/models';
import { analyze } from './core/analyze';
import { applyKeywordRules } from './core/keywords';
import type { RulePack } from './core/rules';
import { matchInternalTransfers } from './core/transfers';
import type { Account, Analysis, UserInputs } from './core/types';

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
): Promise<Analysis> {
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
      if (txs.length) {
        await ai.classifyTransactions(txs, origin, (done, total) => onProgress({ stage: 'model', done, total }));
      }
    }
  } else {
    remaining.forEach((t) => {
      t.category = 'other';
      t.categorySource = 'unclassified';
    });
  }

  onProgress({ stage: 'analysis' });
  return analyze(accounts, pack, inputs);
}
