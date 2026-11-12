import type { CountryCode, LoanProgram } from '../types';
import { FR } from './fr';
import type { RulePack } from './types';
import { US, US_BANK_STATEMENT, US_FHA, US_VA } from './us';

export const RULE_PACKS: Record<CountryCode, RulePack> = { US, FR };

/** Programs offered per country, the first being the default. */
export const PROGRAMS_BY_COUNTRY: Record<CountryCode, RulePack[]> = {
  US: [US, US_FHA, US_VA, US_BANK_STATEMENT],
  FR: [FR],
};

export function getRulePack(country: CountryCode, program?: LoanProgram): RulePack {
  return PROGRAMS_BY_COUNTRY[country].find((p) => p.program === program) ?? RULE_PACKS[country];
}

export type { RulePack } from './types';
