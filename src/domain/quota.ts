/**
 * Per-run hard caps on model calls.
 *
 * These replace a dollar budget. A dollar budget needs a local price table,
 * and a price table is a guess about someone else's billing that goes stale
 * without announcing it. A call count needs no external fact to stay true.
 * The provider enforces spend and refuses us when we are over. This enforces
 * blast radius, so a runaway loop cannot burn a month of quota in one run.
 */
export const MAX_SCORING_CALLS_PER_RUN = 10;
export const MAX_TAILORING_CALLS_PER_RUN = 4;

export type CallKind = 'scoring' | 'tailoring';

/**
 * A switch, not a lookup object. An object indexed by an untrusted string
 * resolves inherited prototype members, so a bad key returns something
 * truthy instead of nothing at all.
 */
export function capFor(kind: CallKind): number {
  switch (kind) {
    case 'scoring':
      return MAX_SCORING_CALLS_PER_RUN;
    case 'tailoring':
      return MAX_TAILORING_CALLS_PER_RUN;
    default:
      throw new Error(`Unknown call kind ${kind}`);
  }
}

export function callAllowed(kind: CallKind, callsMade: number): boolean {
  // NaN would compare false and quietly close the gate. A run that stops
  // making calls for a reason nobody recorded is failure mode 3, silence
  // read as a signal. Refuse loudly instead.
  if (!Number.isInteger(callsMade) || callsMade < 0) {
    throw new Error(
      `callsMade must be a non-negative integer, got ${String(callsMade)}`,
    );
  }
  return callsMade < capFor(kind);
}
