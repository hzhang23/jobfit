import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';

import type { AiRunner } from '../ai/client';
import { scoreJob } from '../ai/score';
import { tailorResume } from '../ai/tailor';
import * as repo from '../db/repo';
import { passesGate } from '../domain/gate';
import {
  MAX_SCORING_CALLS_PER_RUN,
  MAX_TAILORING_CALLS_PER_RUN,
  callAllowed,
} from '../domain/quota';
import { verifyProvenance } from '../domain/provenance';
import { isDegraded, screenPosting } from '../domain/screen';
import type { Env } from '../env';
import { JobicySource } from '../sources/jobicy';
import type { JobSource } from '../sources/types';

export interface JobRunParams {
  userId: string;
  trigger: 'schedule' | 'manual';
  runId: string;
}

export type StepRunner = <T>(name: string, fn: () => Promise<T>) => Promise<T>;

export interface PipelineDeps {
  db: D1Database;
  source: JobSource;
  /**
   * The Workers AI binding, narrowed. Injected rather than read off `env` so
   * the pipeline can be exercised with a fake and never reaches the network
   * in tests.
   */
  ai: AiRunner;
  scoringModel: string;
  tailoringModel: string;
  step: StepRunner;
}

/**
 * The pipeline body, extracted from the Workflow class so it can be exercised
 * without the Workflows runtime.
 *
 * Two rules hold throughout. Steps exchange ids and counts, never payloads,
 * because Workflows persists every step return value. And a failure on one
 * posting is recorded against that posting alone, never allowed to discard
 * the work already done on its siblings.
 */
export async function runPipeline(deps: PipelineDeps, params: JobRunParams): Promise<void> {
  const { db, step } = deps;
  const { userId, runId } = params;

  try {
    const inputs = await step('load-inputs', async () => {
      const resume = await repo.getActiveResume(db, userId);
      if (!resume) throw new NonRetryableError('No active master resume');
      const prefs = await repo.getPrefs(db, userId);
      return {
        resumeId: resume.id,
        resume: resume.content,
        minScore: prefs.min_score,
        keywords: prefs.keywords,
        geo: prefs.geo,
        count: prefs.max_jobs_per_run,
      };
    });

    // Fetch and persist are one step so a retry cannot leave half-written jobs
    // behind, and so the step returns ids rather than 5 KB descriptions.
    const fetched = await step('fetch-and-persist', async () => {
      const result = await deps.source.fetch({
        keywords: inputs.keywords,
        geo: inputs.geo,
        count: inputs.count,
      });
      const inserted = await repo.insertNewJobs(db, userId, deps.source.name, result.postings);
      await repo.setRunCounts(db, runId, {
        fetched: result.postings.length,
        newJobs: inserted.length,
        unparseable: result.unparseable,
      });
      return { newJobIds: inserted.map((j) => j.id) };
    });

    // The deterministic gate. Everything it rejects gets a visible row and
    // never reaches the model.
    const screened = await step('screen-inputs', async () => {
      const passIds: string[] = [];
      let insufficient = 0;

      for (const jobId of fetched.newJobIds) {
        const job = await repo.getJob(db, jobId);
        if (!job) continue;

        const verdict = screenPosting(job);
        if (verdict.ok) {
          passIds.push(jobId);
          continue;
        }

        insufficient++;
        await repo.insertMatch(db, {
          userId,
          runId,
          jobId,
          outcome: 'insufficient_input',
          outcomeDetail: verdict.detail,
          score: null,
          reason: null,
          evidence: null,
        });
      }

      return { passIds, insufficient, total: fetched.newJobIds.length };
    });

    const passedMatchIds: string[] = [];
    // Local blast radius bound. The provider meters spend; this bounds how
    // much work one run can ask for, so a loop that goes wrong cannot burn a
    // month of quota in a single execution.
    let scoringCalls = 0;
    let tailoringCalls = 0;
    // Counted because the degraded verdict depends on it. A posting that was
    // never readable and a posting the model could not score are different
    // causes with the same consequence: no judgment exists for it.
    let scoreFailed = 0;

    for (const jobId of screened.passIds) {
      if (!callAllowed('scoring', scoringCalls)) {
        // Refused before the call, so this posting has no judgment attached
        // to it. It gets a row saying why, because a posting that silently
        // vanishes is failure mode 3.
        await step(`score-capped-${jobId}`, async () => {
          await repo.insertMatch(db, {
            userId,
            runId,
            jobId,
            outcome: 'score_failed',
            outcomeDetail: `Per-run scoring call cap of ${MAX_SCORING_CALLS_PER_RUN} was reached before this posting`,
            score: null,
            reason: null,
            evidence: null,
          });
        });
        scoreFailed += 1;
        continue;
      }

      try {
        const scored = await step(`score-${jobId}`, async () => {
          const job = await repo.getJob(db, jobId);
          if (!job) throw new NonRetryableError(`Job ${jobId} disappeared`);

          const result = await scoreJob({
            ai: deps.ai,
            model: deps.scoringModel,
            resume: inputs.resume,
            job,
          });

          await repo.recordUsage(db, {
            userId,
            runId,
            model: result.usage.model,
            purpose: 'score',
            tokensIn: result.usage.tokensIn,
            tokensOut: result.usage.tokensOut,
          });

          const passed = passesGate(result.data.score, inputs.minScore);
          const matchId = await repo.insertMatch(db, {
            userId,
            runId,
            jobId,
            outcome: passed ? 'passed' : 'rejected',
            outcomeDetail: null,
            score: result.data.score,
            reason: result.data.reason,
            evidence: result.data.evidence,
          });

          return { matchId, passed };
        });

        scoringCalls += 1;
        if (scored.passed) passedMatchIds.push(scored.matchId);
      } catch (error) {
        // Retries are exhausted. This posting alone is marked, and the run
        // continues with its siblings.
        await step(`score-failed-${jobId}`, async () => {
          await repo.insertMatch(db, {
            userId,
            runId,
            jobId,
            outcome: 'score_failed',
            outcomeDetail: String(error).slice(0, 500),
            score: null,
            reason: null,
            evidence: null,
          });
        });
        scoreFailed += 1;
      }
    }

    for (const matchId of passedMatchIds) {
      // The match keeps its score, its reason, and its evidence. It just has
      // no tailored resume. Say so on the match rather than leaving an
      // unexplained gap, because "no resume here" and "no resume here for a
      // reason" read identically to a user and only one of them is honest.
      if (!callAllowed('tailoring', tailoringCalls)) {
        await step(`tailor-capped-${matchId}`, async () => {
          await repo.setOutcomeDetail(
            db,
            matchId,
            `No tailored resume. The per-run tailoring call cap of ${MAX_TAILORING_CALLS_PER_RUN} was reached before this match.`,
          );
        });
        continue;
      }

      try {
        await step(`tailor-${matchId}`, async () => {
          const match = await repo.getMatch(db, matchId);
          if (!match) throw new NonRetryableError(`Match ${matchId} disappeared`);
          const job = await repo.getJob(db, match.job_id);
          if (!job) throw new NonRetryableError(`Job ${match.job_id} disappeared`);

          const result = await tailorResume({
            ai: deps.ai,
            model: deps.tailoringModel,
            resume: inputs.resume,
            job,
          });

          const provenance = verifyProvenance(inputs.resume, result.data);

          await repo.saveTailoredResume(db, {
            matchId,
            userId,
            sourceResumeId: inputs.resumeId,
            content: result.data,
            provenance,
            model: result.usage.model,
          });

          await repo.recordUsage(db, {
            userId,
            runId,
            model: result.usage.model,
            purpose: 'tailor',
            tokensIn: result.usage.tokensIn,
            tokensOut: result.usage.tokensOut,
          });
        });
        tailoringCalls += 1;
      } catch (error) {
        // The match keeps its score and reason, and records why it has no
        // resume. Swallowing this silently is the same defect as an empty
        // dashboard with no receipt.
        //
        // Wrapped in its own step for the same reason every other write is.
        // Unwrapped, a transient D1 error on this one line escapes to the
        // outer catch and fails the whole run, discarding the verdict every
        // other posting already earned. The note explaining one missing
        // resume must not be able to destroy the rest of the receipt.
        await step(`tailor-failed-${matchId}`, async () => {
          await repo.setOutcomeDetail(
            db,
            matchId,
            `No tailored resume. The writer failed after retries: ${String(error).slice(0, 300)}`,
          );
        });
      }
    }

    await step('finalize', async () => {
      // Both causes count. A run where every description was empty and a run
      // where every scoring call failed are equally untrustworthy, and a run
      // that reports "succeeded" after producing no judgment at all is exactly
      // the silence this project exists to remove.
      const degraded = isDegraded(screened.total, screened.insufficient + scoreFailed);
      await repo.finishRun(db, runId, degraded ? 'degraded' : 'succeeded', null);
    });
  } catch (error) {
    await repo.finishRun(db, runId, 'failed', String(error).slice(0, 1000));
  }
}

// `as const` on the whole object, not just `backoff`, is load bearing.
// WorkflowStepConfig's `delay` and `timeout` are template-literal types
// ("10 seconds", "3 minutes"), not `string`. Without `as const` here, TS
// widens the literals to `string` and step.do's overloads reject the object.
const RETRY = {
  retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' },
  timeout: '3 minutes',
} as const;

export class JobRunWorkflow extends WorkflowEntrypoint<Env, JobRunParams> {
  async run(event: WorkflowEvent<JobRunParams>, step: WorkflowStep): Promise<void> {
    await runPipeline(
      {
        db: this.env.DB,
        source: new JobicySource(),
        // The one widening cast in the codebase. `Ai` carries a large
        // model-keyed overload set that a test fake cannot reasonably satisfy,
        // so the pipeline takes the narrow `AiRunner` and the cast lives here,
        // at the single point where the real binding enters.
        ai: this.env.AI as unknown as AiRunner,
        scoringModel: this.env.SCORING_MODEL,
        tailoringModel: this.env.TAILORING_MODEL,
        // A second, narrower cast than the one on `ai` above. `StepRunner`
        // is intentionally unconstrained so a plain async function can stand
        // in for it in tests. The real `WorkflowStep.do` requires its
        // payload to extend `Rpc.Serializable`, a constraint `StepRunner`
        // does not and should not carry. The cast lives at this single call
        // site, where the real Workflows binding enters.
        step: <T>(name: string, fn: () => Promise<T>): Promise<T> =>
          step.do(name, RETRY, fn as () => Promise<Rpc.Serializable<T>>) as unknown as Promise<T>,
      },
      event.payload,
    );
  }
}
