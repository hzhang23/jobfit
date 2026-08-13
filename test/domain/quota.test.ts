import { describe, expect, it } from 'vitest';
import {
  MAX_SCORING_CALLS_PER_RUN,
  MAX_TAILORING_CALLS_PER_RUN,
  callAllowed,
  capFor,
} from '../../src/domain/quota';

describe('capFor', () => {
  it('returns the scoring cap', () => {
    expect(capFor('scoring')).toBe(MAX_SCORING_CALLS_PER_RUN);
  });

  it('returns the tailoring cap', () => {
    expect(capFor('tailoring')).toBe(MAX_TAILORING_CALLS_PER_RUN);
  });

  it('throws for a prototype member name rather than resolving it', () => {
    // The deleted cost table indexed a plain object by an untrusted string,
    // so 'constructor' resolved to Object and produced NaN instead of an
    // error. A switch cannot do that. This test exists so the pattern does
    // not come back.
    for (const bad of ['constructor', 'toString', 'valueOf', '__proto__']) {
      expect(() => capFor(bad as 'scoring')).toThrow(/Unknown call kind/);
    }
  });
});

describe('callAllowed', () => {
  it('allows the first call', () => {
    expect(callAllowed('scoring', 0)).toBe(true);
  });

  it('allows the last call under the cap', () => {
    expect(callAllowed('scoring', MAX_SCORING_CALLS_PER_RUN - 1)).toBe(true);
  });

  it('refuses the call that would exceed the cap', () => {
    expect(callAllowed('scoring', MAX_SCORING_CALLS_PER_RUN)).toBe(false);
  });

  it('refuses once past the cap', () => {
    expect(callAllowed('tailoring', MAX_TAILORING_CALLS_PER_RUN + 5)).toBe(
      false,
    );
  });

  it('caps tailoring separately from scoring', () => {
    expect(callAllowed('tailoring', MAX_TAILORING_CALLS_PER_RUN)).toBe(false);
    expect(callAllowed('scoring', MAX_TAILORING_CALLS_PER_RUN)).toBe(true);
  });

  it('throws on NaN instead of silently closing the gate', () => {
    expect(() => callAllowed('scoring', Number.NaN)).toThrow(
      /non-negative integer/,
    );
  });

  it('throws on a negative or fractional count', () => {
    expect(() => callAllowed('scoring', -1)).toThrow(/non-negative integer/);
    expect(() => callAllowed('scoring', 2.5)).toThrow(/non-negative integer/);
  });
});
