import { describe, expect, it } from 'vitest';
import { parseModelJson } from '../src/core/model-json';

describe('reading JSON from a plain-text model answer', () => {
  // Shape returned by gemini-3.5-flash-lite for the plan prompt in plain text (Nov 23, 2026).
  const fenced = '```json\n{\n  "summary": "Keep the next statements clean.",\n  "steps": [{ "i": 0, "action": "Gather proof for {{large_deposit_count}}.", "why": "Lenders trace funds." }]\n}\n```';

  it('reads an answer wrapped in a ```json fence', () => {
    const j = parseModelJson<{ steps: { action: string }[] }>(fenced);
    expect(j?.steps[0].action).toBe('Gather proof for {{large_deposit_count}}.');
  });

  it('reads a bare object and one with words around it', () => {
    expect(parseModelJson('{"summary":"ok","steps":[]}')).toEqual({ summary: 'ok', steps: [] });
    expect(parseModelJson('Here is the plan:\n{"summary":"ok","steps":[]}\nGood luck.')).toEqual({ summary: 'ok', steps: [] });
  });

  it('returns null for anything else', () => {
    expect(parseModelJson('no json here')).toBeNull();
    expect(parseModelJson('```json\n{"summary": "cut off')).toBeNull();
    expect(parseModelJson('[1, 2]')).toBeNull();
  });
});
