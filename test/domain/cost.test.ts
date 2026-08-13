import { describe, expect, it } from 'vitest';
import { estimateCost } from '../../src/domain/cost';

describe('estimateCost', () => {
  it('prices a scoring call', () => {
    // 2000 in at $0.15/Mtok, 100 out at $0.60/Mtok
    expect(estimateCost('gpt-4o-mini', 2000, 100)).toBeCloseTo(0.00036, 8);
  });

  it('prices a tailoring call', () => {
    // 4000 in at $2.50/Mtok, 1200 out at $10.00/Mtok
    expect(estimateCost('gpt-4o', 4000, 1200)).toBeCloseTo(0.022, 8);
  });

  it('keeps a full run under the 15 cent budget', () => {
    const scoring = 10 * estimateCost('gpt-4o-mini', 2000, 100);
    const tailoring = 4 * estimateCost('gpt-4o', 4000, 1200);
    expect(scoring + tailoring).toBeLessThan(0.15);
  });

  it('throws on an unknown model rather than silently charging zero', () => {
    expect(() => estimateCost('gpt-9-imaginary', 100, 100)).toThrow(
      /No pricing configured for model/,
    );
  });
});
