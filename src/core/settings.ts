/**
 * App settings that can be changed without a release, through Firebase Remote Config.
 * They carry no user data in either direction: the app asks for these three values and
 * nothing else, and every value is validated before use (a bad value keeps the default).
 */
export interface AppSettings {
  /** Gemini model used for the cloud tasks (plan wording, interview questions, letter template). */
  cloudModel: string;
  /** Kill switch: when false, nothing goes to the cloud and the app keeps its local wording. */
  cloudEnabled: boolean;
  /** How many "what is this line?" questions to ask at most. */
  maxQuestions: number;
}

export const SETTING_KEYS = ['cloud_model', 'cloud_enabled', 'clarify_max_questions'] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export const DEFAULT_SETTINGS: AppSettings = {
  cloudModel: import.meta.env.VITE_CLOUD_MODEL || 'gemini-3.5-flash-lite',
  cloudEnabled: true,
  maxQuestions: 6,
};

/** The defaults, in the string form Remote Config expects. */
export function settingsDefaults(base: AppSettings = DEFAULT_SETTINGS): Record<SettingKey, string> {
  return {
    cloud_model: base.cloudModel,
    cloud_enabled: String(base.cloudEnabled),
    clarify_max_questions: String(base.maxQuestions),
  };
}

const MODEL_NAME = /^gemini-[a-z0-9][a-z0-9.-]{0,60}$/;

export function parseSettings(raw: Partial<Record<string, string>>, base: AppSettings = DEFAULT_SETTINGS): AppSettings {
  const model = raw.cloud_model?.trim();
  const enabled = raw.cloud_enabled?.trim().toLowerCase();
  const max = Number(raw.clarify_max_questions);
  return {
    cloudModel: model && MODEL_NAME.test(model) ? model : base.cloudModel,
    cloudEnabled: enabled === 'true' ? true : enabled === 'false' ? false : base.cloudEnabled,
    maxQuestions: Number.isInteger(max) && max >= 0 && max <= 10 ? max : base.maxQuestions,
  };
}
