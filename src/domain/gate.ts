/**
 * A null score means the posting was never scored. That is not a low score,
 * it is the absence of a judgment, so it can never clear the gate. Collapsing
 * those two states was the mechanism of the Module 3 failure.
 */
export function passesGate(score: number | null, minScore: number): boolean {
  if (score === null || !Number.isFinite(score)) return false;
  return score >= minScore;
}
