import { describe, expect, it } from 'vitest';
import { passesGate } from '../../src/domain/gate';

describe('passesGate', () => {
  it('passes at exactly the threshold', () => {
    expect(passesGate(70, 70)).toBe(true);
  });

  it('rejects one point below', () => {
    expect(passesGate(69, 70)).toBe(false);
  });

  // A null score means the model was never asked, which is not the same as a
  // score of zero. It must never pass, and it must never be coerced to 0.
  it('rejects a null score', () => {
    expect(passesGate(null, 0)).toBe(false);
  });

  it('rejects NaN rather than letting it through a comparison', () => {
    expect(passesGate(Number.NaN, 70)).toBe(false);
  });
});
