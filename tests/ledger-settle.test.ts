import { describe, expect, it } from 'vitest';
import { OutboundLedger } from '../src/core/ledger';

describe('ledger entries for sample-file calls', () => {
  it('drops the entry when the call stayed on the device', () => {
    const l = new OutboundLedger();
    const e = l.record('demo_classification', { lines: 40 });
    l.settle(e, 'on_device');
    expect(l.list()).toHaveLength(0);
  });
  it('keeps it, marked as cloud, when the cloud answered', () => {
    const l = new OutboundLedger();
    const e = l.record('demo_classification', { lines: 40 });
    l.settle(e, 'in_cloud');
    expect(l.list()).toHaveLength(1);
    expect(l.list()[0].inferenceSource).toBe('in_cloud');
  });
});
