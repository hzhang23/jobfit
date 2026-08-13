export interface Env {
  DB: D1Database;
  JOB_RUN: Workflow;
  // Optional on purpose. The assets binding is only declared once Task 10
  // has built the frontend, so the type must admit its absence rather than
  // let a dereference through the type checker and crash at runtime.
  ASSETS?: Fetcher;
  // Workers AI. Cloudflare authenticates this binding for us, so the app holds
  // no model provider secret at all. Quota is Cloudflare's to enforce: when we
  // are over it, the call fails and the pipeline records the refusal.
  AI: Ai;
  SCORING_MODEL: string;
  TAILORING_MODEL: string;
}
