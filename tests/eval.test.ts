import { describe, expect, it } from 'vitest';
import { evalSet } from '../src/eval/dataset';
import { evaluate } from '../src/eval/run';

describe('evaluation set (rules only, the baseline)', () => {
  it('reports coverage and precision', async () => {
    const r = await evaluate(evalSet());
    console.info(
      `rules only: ${r.lines} lines, coverage ${(r.ruleCoverage * 100).toFixed(1)}%, precision ${(r.rulePrecision * 100).toFixed(1)}%, accuracy ${(r.accuracy * 100).toFixed(1)}%`,
    );
    expect(r.lines).toBeGreaterThanOrEqual(190);
    expect(r.rulePrecision).toBeGreaterThan(0.9); // when the rules answer, they are right
    expect(r.ruleCoverage).toBeLessThan(0.8); // and they leave real work for the model
  });
});
