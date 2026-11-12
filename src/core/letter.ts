/**
 * The cloud returns a letter template with {{placeholders}}; the real values are filled
 * in here, on the device. The cloud never sees the amounts, dates or names.
 */
export function fillTemplate(
  template: string,
  values: Record<string, string>,
): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const text = template.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (whole, key: string) => {
    const v = values[key];
    if (v === undefined || v === '') {
      missing.add(key);
      return whole;
    }
    return v;
  });
  return { text, missing: [...missing] };
}

export function listPlaceholders(template: string): string[] {
  return [...new Set([...template.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)].map((m) => m[1]))];
}

/**
 * A cloud template is used only if the applicant's paragraph has a clean place to go:
 * {{explanation}} exactly once, alone on its line. Gemini once returned it three times,
 * mid-sentence ("Regarding my debt ratio, {{explanation}}. Concerning the overdraft, ..."),
 * which pasted the same paragraph three times into broken sentences.
 */
export function isUsableTemplate(template: string): boolean {
  const slots = template.match(/\{\{\s*explanation\s*\}\}/gi) ?? [];
  if (slots.length !== 1) return false;
  return template.split('\n').some((line) => /^\s*\{\{\s*explanation\s*\}\}\s*$/i.test(line));
}
