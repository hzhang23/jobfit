import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '../../src/db/repo';
import { runPipeline, type StepRunner } from '../../src/workflow/run';
import type { AiRunner } from '../../src/ai/client';
import { MAX_SCORING_CALLS_PER_RUN, MAX_TAILORING_CALLS_PER_RUN } from '../../src/domain/quota';
import type { FetchResult, JobSource, RawPosting } from '../../src/sources/types';

const USER = 'local-user';
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/** Runs step bodies inline, which is what step.do does on a first attempt. */
const inlineStep: StepRunner = async (_name, fn) => fn();

function posting(n: number, description: string): RawPosting {
  return {
    sourceId: `ext-${n}`,
    title: `Backend Engineer ${n}`,
    company: `Company ${n}`,
    location: 'usa',
    url: `https://example.com/${n}`,
    description,
    postedAt: 1_700_000_000_000,
  };
}

const REAL_DESCRIPTION = [
  'We are hiring a backend engineer to own our payments platform.',
  'You will design services in TypeScript and Go, operate them on Kubernetes,',
  'and partner with product to ship billing features end to end.',
  'Requirements include five years of experience building distributed systems,',
  'strong knowledge of relational databases such as PostgreSQL, comfort with',
  'observability tooling, and a track record of mentoring other engineers.',
].join(' ');

function fakeSource(result: FetchResult): JobSource {
  return { name: 'jobicy', fetch: async () => result };
}

/**
 * A fake Workers AI binding. It answers scoring calls with the next score in
 * the list and tailoring calls with resume text. A scoring call is the one
 * that carries a response_format, which is how the real client distinguishes
 * them too.
 */
function aiStub(scores: number[]) {
  let scoreIndex = 0;
  const run = vi.fn(async (_model: string, input: Record<string, unknown>) => {
    const isScoring = input.response_format !== undefined;

    const response = isScoring
      ? {
          score: scores[scoreIndex++] ?? 0,
          reason: 'Overlap on Go and Kubernetes.',
          evidence: [{ jdQuote: 'services in Go', resumeQuote: 'services in Go' }],
        }
      : 'Ricky Zhang\nBuilt services in Go on Kubernetes';

    return { response, usage: { prompt_tokens: 2000, completion_tokens: 100 } };
  });
  // AiRunner is `{ run(model, input) }`, an object, not a bare function.
  // Wrapping here is what lets `opts.ai.run(...)` in the real client resolve.
  return { ai: { run } as unknown as AiRunner, run };
}

async function deps(source: JobSource, ai: AiRunner) {
  return {
    db: env.DB,
    source,
    ai,
    scoringModel: MODEL,
    tailoringModel: MODEL,
    step: inlineStep,
  };
}

describe('runPipeline', () => {
  let runId: string;

  beforeEach(async () => {
    await repo.saveResume(env.DB, USER, 'Ricky Zhang\nBuilt services in Go on Kubernetes');
    runId = await repo.createRun(env.DB, USER, 'manual');
  });

  it('scores, gates, tailors, and writes a receipt', async () => {
    const source = fakeSource({
      postings: [posting(1, REAL_DESCRIPTION), posting(2, REAL_DESCRIPTION)],
      unparseable: 0,
    });

    await runPipeline(await deps(source, aiStub([88, 40]).ai), {
      userId: USER,
      trigger: 'manual',
      runId,
    });

    const receipt = await repo.getRunReceipt(env.DB, runId);
    expect(receipt).toMatchObject({
      fetched: 2,
      alreadySeen: 0,
      insufficient: 0,
      scored: 2,
      passed: 1,
      rejected: 1,
      topRejectedScore: 40,
    });

    const run = await repo.getRun(env.DB, runId);
    expect(run!.status).toBe('succeeded');
    expect((await repo.sumRunUsage(env.DB, runId)).calls).toBeGreaterThan(0);

    const passed = await repo.listMatches(env.DB, USER, { outcome: 'passed' });
    const tailored = await repo.getTailoredResume(env.DB, passed[0]!.id);
    expect(tailored!.content).toContain('Go');
    expect(tailored!.unverified_count).toBe(0);
  });

  // The Module 3 regression, end to end.
  it('marks the run degraded and calls no model when every description is empty', async () => {
    const { ai, run } = aiStub([]);
    const source = fakeSource({
      postings: [posting(1, ''), posting(2, ''), posting(3, '')],
      unparseable: 0,
    });

    await runPipeline(await deps(source, ai), { userId: USER, trigger: 'schedule', runId });

    expect(run).not.toHaveBeenCalled();

    const receipt = await repo.getRunReceipt(env.DB, runId);
    expect(receipt).toMatchObject({ fetched: 3, insufficient: 3, scored: 0, passed: 0 });

    const runRow = await repo.getRun(env.DB, runId);
    expect(runRow!.status).toBe('degraded');
    expect(await repo.sumRunUsage(env.DB, runId)).toEqual({ calls: 0, tokensIn: 0, tokensOut: 0 });

    const dropped = await repo.listMatches(env.DB, USER, { outcome: 'insufficient_input' });
    expect(dropped[0]!.score).toBeNull();
    expect(dropped[0]!.outcome_detail).toContain('400 character floor');
  });

  // Regression test. The degraded verdict used to count only postings that
  // failed the screening gate, so a feed that returned mostly rows the adapter
  // could not parse reported itself healthy. `fetched` counts postings that
  // parsed, so those rows were invisible to every number on the receipt. That
  // is the original incident in different clothes.
  it('marks the run degraded when most of what came back could not be parsed', async () => {
    const { ai } = aiStub([88, 88]);
    const source = fakeSource({
      postings: [posting(1, REAL_DESCRIPTION), posting(2, REAL_DESCRIPTION)],
      unparseable: 9,
    });

    await runPipeline(await deps(source, ai), { userId: USER, trigger: 'schedule', runId });

    const receipt = await repo.getRunReceipt(env.DB, runId);
    expect(receipt).toMatchObject({ fetched: 2, unparseable: 9, scored: 2, passed: 2 });

    // 9 unreadable out of 11 candidates is over the ratio, even though both
    // postings that did parse were scored and both passed.
    const runRow = await repo.getRun(env.DB, runId);
    expect(runRow!.status).toBe('degraded');
  });

  it('leaves a run succeeded when only a few rows could not be parsed', async () => {
    const { ai } = aiStub([88, 88, 88, 88]);
    const source = fakeSource({
      postings: [1, 2, 3, 4].map((i) => posting(i, REAL_DESCRIPTION)),
      unparseable: 1,
    });

    await runPipeline(await deps(source, ai), { userId: USER, trigger: 'schedule', runId });

    expect((await repo.getRun(env.DB, runId))!.status).toBe('succeeded');
    expect(await repo.getRunReceipt(env.DB, runId)).toMatchObject({ unparseable: 1, passed: 4 });
  });

  it('records score_failed for one posting without killing the run', async () => {
    let call = 0;
    // The first scoring call rejects the way a real provider rejects: quota,
    // rate limit, and "JSON Mode couldn't be met" all arrive as a throw.
    const flakyRun = vi.fn(async (_model: string, input: Record<string, unknown>) => {
      if (input.response_format !== undefined && call++ === 0) {
        throw new Error('Workers AI: capacity temporarily exceeded');
      }
      return {
        response: {
          score: 91,
          reason: 'ok',
          evidence: [{ jdQuote: 'Go', resumeQuote: 'Go' }],
        },
        usage: { prompt_tokens: 100, completion_tokens: 10 },
      };
    });
    // Same AiRunner shape fix as aiStub: wrap the mock in a `run` method.
    const flaky = { run: flakyRun } as unknown as AiRunner;

    const source = fakeSource({
      postings: [posting(1, REAL_DESCRIPTION), posting(2, REAL_DESCRIPTION)],
      unparseable: 0,
    });

    await runPipeline(await deps(source, flaky), { userId: USER, trigger: 'manual', runId });

    const receipt = await repo.getRunReceipt(env.DB, runId);
    expect(receipt.scoreFailed).toBe(1);
    expect(receipt.passed).toBe(1);
    expect((await repo.getRun(env.DB, runId))!.status).toBe('succeeded');
  });

  it('skips postings it has already seen', async () => {
    const source = fakeSource({ postings: [posting(1, REAL_DESCRIPTION)], unparseable: 0 });

    await runPipeline(await deps(source, aiStub([88]).ai), { userId: USER, trigger: 'manual', runId });

    const second = await repo.createRun(env.DB, USER, 'manual');
    await runPipeline(await deps(source, aiStub([88]).ai), {
      userId: USER,
      trigger: 'manual',
      runId: second,
    });

    const receipt = await repo.getRunReceipt(env.DB, second);
    expect(receipt).toMatchObject({ fetched: 1, alreadySeen: 1, scored: 0, passed: 0 });
    expect((await repo.getRun(env.DB, second))!.status).toBe('succeeded');
  });

  it('fails the run before calling the model when there is no master resume', async () => {
    // runs.user_id has a foreign key on users(id). repo.ts exposes no
    // user-creation function (users are seeded only by the migration), so a
    // user row for 'nobody' has to exist before createRun will accept it.
    // 'nobody' deliberately gets no resume, which is the condition under test.
    await env.DB.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)')
      .bind('nobody', 'nobody@jobfit.dev', Date.now())
      .run();
    const other = await repo.createRun(env.DB, 'nobody', 'manual');
    const { ai, run: aiRun } = aiStub([]);

    await runPipeline(await deps(fakeSource({ postings: [], unparseable: 0 }), ai), {
      userId: 'nobody',
      trigger: 'manual',
      runId: other,
    });

    expect(aiRun).not.toHaveBeenCalled();
    const run = await repo.getRun(env.DB, other);
    expect(run!.status).toBe('failed');
    expect(run!.error).toMatch(/no active master resume/i);
  });

  // Task 3 built callAllowed. This is the test that proves it is wired in
  // rather than sitting unused. Preferences allow 12 postings through
  // screening, and the cap must still stop scoring at 10.
  it('stops scoring at the per-run call cap and says so on the receipt', async () => {
    await repo.savePrefs(env.DB, USER, { max_jobs_per_run: 12 });
    const postings = Array.from({ length: 12 }, (_, i) => posting(i + 1, REAL_DESCRIPTION));
    const { ai, run: aiRun } = aiStub(Array(12).fill(30));

    await runPipeline(await deps(fakeSource({ postings, unparseable: 0 }), ai), {
      userId: USER,
      trigger: 'manual',
      runId,
    });

    expect(aiRun).toHaveBeenCalledTimes(MAX_SCORING_CALLS_PER_RUN);

    const capped = await repo.listMatches(env.DB, USER, { outcome: 'score_failed' });
    expect(capped).toHaveLength(2);
    expect(capped[0]!.outcome_detail).toMatch(/call cap/i);
    expect(capped[0]!.score).toBeNull();
  });

  // Regression test for the finding that isDegraded only counted postings
  // that failed the screening gate, so a run where every scoring call
  // rejected (an AI outage, not a data quality problem) still reported
  // 'succeeded' with an empty dashboard. That is the same silent-failure
  // shape the screening gate exists to prevent, just downstream of it.
  it('marks the run degraded, not succeeded, when every scoring call rejects', async () => {
    const alwaysThrows: AiRunner = {
      run: vi.fn(async () => {
        throw new Error('Workers AI: capacity temporarily exceeded');
      }),
    };
    const source = fakeSource({
      postings: [
        posting(1, REAL_DESCRIPTION),
        posting(2, REAL_DESCRIPTION),
        posting(3, REAL_DESCRIPTION),
      ],
      unparseable: 0,
    });

    await runPipeline(await deps(source, alwaysThrows), {
      userId: USER,
      trigger: 'manual',
      runId,
    });

    const receipt = await repo.getRunReceipt(env.DB, runId);
    // scored counts postings that came back with a real score, so a run where
    // every scoring call failed reports scored: 0 and scoreFailed: 3. If those
    // three counted as scored, the dashboard would claim it scored three
    // postings while also saying none of them could be scored.
    expect(receipt).toMatchObject({ scoreFailed: 3, scored: 0, passed: 0 });
    expect((await repo.getRun(env.DB, runId))!.status).toBe('degraded');
  });

  it('says so on a match refused by the tailoring cap', async () => {
    await repo.savePrefs(env.DB, USER, { max_jobs_per_run: 6 });
    const count = MAX_TAILORING_CALLS_PER_RUN + 2;
    const postings = Array.from({ length: count }, (_, i) => posting(i + 1, REAL_DESCRIPTION));
    const { ai } = aiStub(Array(count).fill(90));

    await runPipeline(await deps(fakeSource({ postings, unparseable: 0 }), ai), {
      userId: USER,
      trigger: 'manual',
      runId,
    });

    const passed = await repo.listMatches(env.DB, USER, { outcome: 'passed', limit: 20 });
    expect(passed).toHaveLength(count);

    const capped = passed.filter((m) => m.outcome_detail && /tailoring call cap/i.test(m.outcome_detail));
    expect(capped).toHaveLength(count - MAX_TAILORING_CALLS_PER_RUN);
    for (const match of capped) {
      expect(match.score).not.toBeNull();
      expect(match.reason).not.toBeNull();
    }
  });

  it('says so on a match whose tailoring call fails', async () => {
    const failTailor = vi.fn(async (_model: string, input: Record<string, unknown>) => {
      const isScoring = input.response_format !== undefined;
      if (isScoring) {
        return {
          response: {
            score: 90,
            reason: 'Overlap on Go and Kubernetes.',
            evidence: [{ jdQuote: 'services in Go', resumeQuote: 'services in Go' }],
          },
          usage: { prompt_tokens: 2000, completion_tokens: 100 },
        };
      }
      throw new Error('Workers AI: writer capacity exceeded');
    });
    const ai = { run: failTailor } as unknown as AiRunner;

    const source = fakeSource({ postings: [posting(1, REAL_DESCRIPTION)], unparseable: 0 });

    await runPipeline(await deps(source, ai), { userId: USER, trigger: 'manual', runId });

    const passed = await repo.listMatches(env.DB, USER, { outcome: 'passed' });
    expect(passed[0]!.outcome_detail).toMatch(/writer failed/i);
    expect(passed[0]!.score).toBe(90);
  });
});
