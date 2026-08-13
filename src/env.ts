export interface Env {
  DB: D1Database;
  JOB_RUN: Workflow;
  ASSETS: Fetcher;
  OPENAI_API_KEY: string;
  SCORING_MODEL: string;
  TAILORING_MODEL: string;
}
