import { describe, expect, it } from 'vitest';
import { isTransient, withOneRetry } from '../src/ai/retry';

const noWait = async () => undefined;

describe('one silent retry on a server hiccup', () => {
  it('retries once after a 500 and returns the second answer', async () => {
    let calls = 0;
    const result = await withOneRetry(async () => {
      calls++;
      if (calls === 1) throw new Error('[500 ] Internal error encountered.');
      return 'ok';
    }, 0, noWait);
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });

  it('gives up after the second failure', async () => {
    let calls = 0;
    await expect(withOneRetry(async () => { calls++; throw new Error('503 Service Unavailable'); }, 0, noWait)).rejects.toThrow('503');
    expect(calls).toBe(2);
  });

  it('does not retry a request the server refused', async () => {
    let calls = 0;
    await expect(withOneRetry(async () => { calls++; throw new Error('[403 ] App Check token is invalid'); }, 0, noWait)).rejects.toThrow('403');
    expect(calls).toBe(1);
  });

  it('knows which errors are transient', () => {
    expect(isTransient(new Error('[429 ] Resource exhausted'))).toBe(true);
    expect(isTransient(new Error('The model is overloaded'))).toBe(true);
    expect(isTransient(new Error('[400 ] Invalid JSON schema'))).toBe(false);
  });
});
