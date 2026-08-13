export interface Env {
  DB: D1Database;
  JOB_RUN: Workflow;
  ASSETS: Fetcher;
  // Workers AI. Cloudflare authenticates this binding for us, so the app holds
  // no model provider secret at all. Quota is Cloudflare's to enforce: when we
  // are over it, the call fails and the pipeline records the refusal.
  AI: Ai;
  SCORING_MODEL: string;
  TAILORING_MODEL: string;
}
