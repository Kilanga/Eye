/** Server-side hiccups worth one more try: overload, rate limit, internal error, gateway. */
export function isTransient(err: unknown): boolean {
  const m = String((err as Error)?.message ?? err);
  return /\b(429|500|502|503|504)\b|high demand|overloaded|internal error|unavailable/i.test(m);
}

/**
 * Runs `call`, and once more after `delayMs` if it failed for a transient reason.
 * The Gemini API answers 500 or 503 on a fair share of calls under load; a single silent
 * retry hides most of them without hammering the service.
 */
export async function withOneRetry<T>(call: () => Promise<T>, delayMs = 1500, wait = sleep): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (!isTransient(err)) throw err;
    await wait(delayMs);
    return call();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
