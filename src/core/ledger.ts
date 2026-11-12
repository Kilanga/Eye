import { LEVER_IDS } from './plan';
import { PROFILE_KEYS } from './profile';
import { PROGRAMS, type CheckId } from './types';

/** One entry per request that left the device. Shown to the user in the "Outbound ledger" screen. */
export interface LedgerEntry {
  at: string;
  kind: 'plan' | 'letter_template' | 'interview' | 'demo_classification' | 'demo_question' | 'demo_explanation' | 'app_settings';
  /** Exactly what was sent, as JSON. */
  payload: string;
  bytes: number;
  inferenceSource?: string;
}

export class PrivacyViolation extends Error {}

const CHECK_IDS: readonly CheckId[] = [
  'statement_coverage',
  'debt_ratio',
  'overdraft',
  'large_deposits',
  'gambling',
  'payday_loans',
  'savings_regularity',
  'recurring_obligations',
  'cash_deposits',
  'statement_recency',
  'funds_to_close',
];
const ALLOWED_STRINGS = new Set<string>(['US', 'FR', 'ok', 'watch', 'alert', ...CHECK_IDS, ...LEVER_IDS, ...PROGRAMS]);
const ROOT_EXTRA_KEYS = ['flags', 'steps'];
const NESTED_KEYS = ['id', 'status', 'week', 'checkId', 'lever'];

/**
 * Throws if a payload for real user data contains anything but whitelisted keys,
 * numbers and enum strings - or any raw label from the user's statements.
 * This is the line of code the privacy promise rests on; it is unit-tested.
 */
export function assertSafeForCloud(payload: unknown, rawLabels: Iterable<string>): void {
  const labels = [...rawLabels].map((l) => l.toLowerCase()).filter((l) => l.length >= 6);
  const json = JSON.stringify(payload).toLowerCase();
  for (const label of labels) {
    if (json.includes(label)) throw new PrivacyViolation('A statement label was about to leave the device.');
  }
  visit(payload, 'root');

  function visit(value: unknown, path: string): void {
    if (typeof value === 'number') {
      if (!Number.isFinite(value) && value !== -1) throw new PrivacyViolation(`Non-finite number at ${path}`);
      return;
    }
    if (typeof value === 'string') {
      if (!ALLOWED_STRINGS.has(value)) throw new PrivacyViolation(`Free text at ${path}`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => visit(v, `${path}[${i}]`));
      return;
    }
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        const allowed =
          path === 'root'
            ? (PROFILE_KEYS as readonly string[]).includes(k) || ROOT_EXTRA_KEYS.includes(k)
            : NESTED_KEYS.includes(k);
        if (!allowed) throw new PrivacyViolation(`Unexpected key ${path}.${k}`);
        visit(v, `${path}.${k}`);
      }
      return;
    }
    throw new PrivacyViolation(`Unexpected value at ${path}`);
  }
}

export class OutboundLedger {
  private entries: LedgerEntry[] = [];
  private listeners: ((e: LedgerEntry[]) => void)[] = [];

  record(kind: LedgerEntry['kind'], payload: unknown): LedgerEntry {
    const json = JSON.stringify(payload);
    const entry: LedgerEntry = {
      at: new Date().toISOString(),
      kind,
      payload: json,
      bytes: new TextEncoder().encode(json).length,
    };
    this.entries.push(entry);
    this.emit();
    return entry;
  }

  setSource(entry: LedgerEntry, source: string | undefined): void {
    entry.inferenceSource = source;
    this.emit();
  }

  /** Drops an entry for a call that, in the end, stayed on the device (nothing was sent). */
  discard(entry: LedgerEntry): void {
    this.entries = this.entries.filter((e) => e !== entry);
    this.emit();
  }

  /**
   * For sample-file calls that may fall back to the cloud: keeps the entry only if the answer
   * really came from the cloud.
   */
  settle(entry: LedgerEntry | undefined, source: string | undefined): void {
    if (!entry) return;
    if (source === 'in_cloud') this.setSource(entry, source);
    else this.discard(entry);
  }

  list(): readonly LedgerEntry[] {
    return this.entries;
  }

  onChange(fn: (e: LedgerEntry[]) => void): void {
    this.listeners.push(fn);
  }

  private emit(): void {
    this.listeners.forEach((fn) => fn([...this.entries]));
  }
}
