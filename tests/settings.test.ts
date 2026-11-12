import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings, settingsDefaults } from '../src/core/settings';

describe('app settings from Remote Config', () => {
  it('keeps the defaults when nothing is set', () => {
    expect(parseSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it('reads valid values', () => {
    expect(parseSettings({ cloud_model: 'gemini-3.5-flash', cloud_enabled: 'false', clarify_max_questions: '3' })).toEqual({
      cloudModel: 'gemini-3.5-flash',
      cloudEnabled: false,
      maxQuestions: 3,
    });
  });

  it('ignores invalid values one by one', () => {
    const s = parseSettings({ cloud_model: 'gpt-4; drop', cloud_enabled: 'maybe', clarify_max_questions: '99' });
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ cloud_model: '', clarify_max_questions: '2.5' })).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ clarify_max_questions: '0' }).maxQuestions).toBe(0);
  });

  it('round-trips the defaults through their string form', () => {
    expect(parseSettings(settingsDefaults())).toEqual(DEFAULT_SETTINGS);
  });
});
