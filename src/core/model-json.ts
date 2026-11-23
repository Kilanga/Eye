/**
 * Reads a JSON object from a model answer given in plain text: with or without a ```json fence,
 * with or without words around it. Returns null when there is no valid JSON object.
 */
export function parseModelJson<T = unknown>(text: string): T | null {
  const unfenced = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  for (const candidate of [unfenced, unfenced.slice(unfenced.indexOf('{'), unfenced.lastIndexOf('}') + 1)]) {
    try {
      const value = JSON.parse(candidate) as unknown;
      if (value && typeof value === 'object' && !Array.isArray(value)) return value as T;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}
