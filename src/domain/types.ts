export type MatchOutcome =
  /** Never sent to the model, because the per-run call cap was already spent. */
  | 'not_attempted'
  | 'insufficient_input'
  | 'rejected'
  | 'passed'
  | 'score_failed';

export type AppStatus = 'new' | 'interested' | 'applied' | 'rejected';

export type RunStatus = 'running' | 'succeeded' | 'degraded' | 'failed';

export interface EvidenceItem {
  jdQuote: string;
  resumeQuote: string;
}
