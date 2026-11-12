import { describe, expect, it } from 'vitest';
import { getRulePack } from '../src/core/rules';
import { applyAnswer, groupKey, pickQuestions } from '../src/core/clarify';
import { usAlmostReady } from '../src/demo/generate';
import { runPipeline } from '../src/pipeline';
import type { Transaction } from '../src/core/types';

/** What Gemini Nano answered for Maya's sample on real hardware (Chrome 157), confidence "high". */
const nanoAsOnRealHardware = {
  async classifyTransactions(txs: Transaction[]) {
    for (const t of txs) {
      t.category = /MOBILE CHECK DEPOSIT/.test(t.rawLabel) ? 'income_other' : /BRIGHTHOME|MEGAMART/.test(t.rawLabel) ? 'housing' : 'other';
      t.categorySource = 'on_device';
      t.categoryConfidence = 'high';
    }
  },
} as never;

describe("a model's guess never clears a lender check", () => {
  it('keeps the $6,000 deposit to explain when Nano calls it salary', async () => {
    const p = usAlmostReady();
    const nanoSaysSalary = {
      async classifyTransactions(txs: Transaction[]) {
        for (const t of txs) {
          t.category = /MOBILE CHECK DEPOSIT/.test(t.rawLabel) ? 'income_salary' : 'other';
          t.categorySource = 'on_device';
          t.categoryConfidence = 'high';
        }
      },
    } as never;
    const a = await runPipeline(p.accounts, getRulePack('US'), { grossMonthlyIncome: 6400, projectedHousingPayment: 1850 }, nanoSaysSalary);
    expect(a.checks.find((c) => c.id === 'large_deposits')?.status).toBe('watch');
  });

  it('keeps the $6,000 deposit to explain when Nano calls it income', async () => {
    const p = usAlmostReady();
    const a = await runPipeline(p.accounts, getRulePack('US'), { grossMonthlyIncome: 6400, projectedHousingPayment: 1850 }, nanoAsOnRealHardware);
    expect(a.checks.find((c) => c.id === 'large_deposits')?.status).toBe('watch');
  });

  it('keeps the fixed monthly BrightHome payment as a possible debt when Nano calls it housing', async () => {
    const p = usAlmostReady();
    const a = await runPipeline(p.accounts, getRulePack('US'), { grossMonthlyIncome: 6400, projectedHousingPayment: 1850 }, nanoAsOnRealHardware);
    expect(a.obligations.some((o) => /BRIGHTHOME/.test(o.exampleLabel))).toBe(true);
  });

  it('asks the user about a large deposit that only a model has read', async () => {
    const p = usAlmostReady();
    await runPipeline(p.accounts, getRulePack('US'), { grossMonthlyIncome: 6400, projectedHousingPayment: 1850 }, nanoAsOnRealHardware);
    const qs = pickQuestions(p.accounts.flatMap((acc) => acc.transactions), 6400);
    expect(qs[0].exampleLabel).toMatch(/MOBILE CHECK DEPOSIT/);
  });

  it("lets the user answer a line the model was confident about", async () => {
    const p = usAlmostReady();
    await runPipeline(p.accounts, getRulePack('US'), { grossMonthlyIncome: 6400, projectedHousingPayment: 1850 }, nanoAsOnRealHardware);
    const txs = p.accounts.flatMap((acc) => acc.transactions);
    const deposit = txs.find((t) => /MOBILE CHECK DEPOSIT/.test(t.rawLabel))!;
    const changed = applyAnswer(txs, groupKey(deposit), 'p2p_transfer');
    expect(changed.length).toBe(1);
    expect(deposit.categorySource).toBe('user');
  });
});
