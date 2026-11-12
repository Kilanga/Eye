import type { CountryCode } from '../types';
import { FR } from './fr';
import type { RulePack } from './types';
import { US } from './us';

export const RULE_PACKS: Record<CountryCode, RulePack> = { US, FR };

export function getRulePack(country: CountryCode): RulePack {
  return RULE_PACKS[country];
}

export type { RulePack } from './types';
