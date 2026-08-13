export type MatchOutcome =
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
