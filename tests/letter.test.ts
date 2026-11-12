import { describe, expect, it } from 'vitest';
import { isUsableTemplate } from '../src/core/letter';
import { LOCAL_LETTER_TEMPLATE } from '../src/core/interview';

describe('cloud letter template', () => {
  it('keeps a template with the paragraph once, on its own line', () => {
    expect(isUsableTemplate(LOCAL_LETTER_TEMPLATE)).toBe(true);
    expect(isUsableTemplate('{{date}}\n\nDear Underwriter,\n\nI would like to explain a few items.\n\n{{explanation}}\n\nSincerely,\n{{applicant_name}}')).toBe(true);
  });

  it('rejects the template Gemini returned on the deployed site (Nov 2026)', () => {
    const seen =
      'Dear Underwriter, I am writing to provide clarification regarding specific items on my mortgage application. Regarding my debt ratio and recurring obligations, {{explanation}}. Concerning the recent overdraft on my account, {{explanation}}. Regarding the large deposit, {{explanation}}.\n\nSincerely,\n{{applicant_name}}';
    expect(isUsableTemplate(seen)).toBe(false);
  });

  it('rejects the paragraph placed mid-sentence, or missing', () => {
    expect(isUsableTemplate('Dear Underwriter, about the deposit, {{explanation}}. Sincerely.')).toBe(false);
    expect(isUsableTemplate('Dear Underwriter,\n\nSincerely,\n{{applicant_name}}')).toBe(false);
  });
});
