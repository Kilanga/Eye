import type { CloudProfile } from './profile';
import type { CheckId, CheckStatus } from './types';

/**
 * Follow-up scans: "run it again in 30 days and watch the lights change".
 *
 * A snapshot is the same summary as the cloud profile (bucketed numbers and statuses, no
 * transaction, no label), plus a date. It is kept in memory for the session and, only if the
 * user ticks the box, in this browser's localStorage. Statements are never stored.
 */
export interface Snapshot {
  at: string;
  profile: CloudProfile;
}

export type Trend = 'better' | 'worse' | 'same' | 'new';

export interface CheckChange {
  id: CheckId;
  before?: CheckStatus;
  after: CheckStatus;
  trend: Trend;
}

export interface Comparison {
  daysBetween: number;
  checks: CheckChange[];
  debtRatioPct: { before: number; after: number };
  improved: number;
  worsened: number;
}

const RANK: Record<CheckStatus, number> = { ok: 0, watch: 1, alert: 2 };

export function takeSnapshot(profile: CloudProfile, at = new Date()): Snapshot {
  return { at: at.toISOString(), profile };
}

export function compareSnapshots(before: Snapshot, after: Snapshot): Comparison | null {
  if (before.profile.country !== after.profile.country) return null;
  const prev = new Map(before.profile.checks.map((c) => [c.id, c.status]));
  const checks: CheckChange[] = after.profile.checks.map((c) => {
    const b = prev.get(c.id);
    const trend: Trend =
      b === undefined ? 'new' : RANK[c.status] < RANK[b] ? 'better' : RANK[c.status] > RANK[b] ? 'worse' : 'same';
    return { id: c.id, before: b, after: c.status, trend };
  });
  const days = Math.round((Date.parse(after.at) - Date.parse(before.at)) / 86_400_000);
  return {
    daysBetween: Math.max(0, days),
    checks,
    debtRatioPct: { before: before.profile.debtRatioPct, after: after.profile.debtRatioPct },
    improved: checks.filter((c) => c.trend === 'better').length,
    worsened: checks.filter((c) => c.trend === 'worse').length,
  };
}

const KEY = 'underwriters-eye.snapshot';

/** Browser storage can be missing or throw (private mode, sandboxed frames): never fatal. */
export function saveSnapshot(s: Snapshot): boolean {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

export function loadSnapshot(): Snapshot | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    return raw ? (JSON.parse(raw) as Snapshot) : null;
  } catch {
    return null;
  }
}

export function clearSnapshot(): void {
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
