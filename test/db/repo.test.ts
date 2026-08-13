import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import * as repo from '../../src/db/repo';
import type { RawPosting } from '../../src/sources/types';

const USER = 'local-user';
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

function posting(n: number, description = 'a real description'): RawPosting {
  return {
    sourceId: `ext-${n}`,
    title: `Engineer ${n}`,
    company: `Company ${n}`,
    location: 'usa',
    url: `https://example.com/${n}`,
    description,
    postedAt: 1_700_000_000_000,
  };
}

describe('repo', () => {
  let runId: string;

  beforeEach(async () => {
    runId = await repo.createRun(env.DB, USER, 'manual');
  });

  it('stores and reads back the active resume, bumping the version', async () => {
    const first = await repo.saveResume(env.DB, USER, 'v1 body');
    expect(first.version).toBe(1);

    const second = await repo.saveResume(env.DB, USER, 'v2 body');
    expect(second.version).toBe(2);

    const active = await repo.getActiveResume(env.DB, USER);
    expect(active).toMatchObject({ id: second.id, content: 'v2 body', version: 2 });
  });

  it('returns null when no resume has been saved', async () => {
    expect(await repo.getActiveResume(env.DB, 'nobody')).toBeNull();
  });

  it('reads seeded preferences and applies a partial update', async () => {
    expect(await repo.getPrefs(env.DB, USER)).toMatchObject({ min_score: 70, geo: 'usa' });

    const updated = await repo.savePrefs(env.DB, USER, { min_score: 55, keywords: 'data engineer' });
    expect(updated).toMatchObject({ min_score: 55, keywords: 'data engineer', geo: 'usa' });
  });

  it('inserts new postings and returns only the ones it had not seen', async () => {
    const first = await repo.insertNewJobs(env.DB, USER, 'jobicy', [posting(1), posting(2)]);
    expect(first).toHaveLength(2);

    const second = await repo.insertNewJobs(env.DB, USER, 'jobicy', [posting(2), posting(3)]);
    expect(second.map((j) => j.external_id)).toEqual(['ext-3']);
  });

  it('records a match and reads it back', async () => {
    const [job] = await repo.insertNewJobs(env.DB, USER, 'jobicy', [posting(1)]);
    const matchId = await repo.insertMatch(env.DB, {
      userId: USER,
      runId,
      jobId: job!.id,
      outcome: 'passed',
      outcomeDetail: null,
      score: 88,
      reason: 'Strong overlap',
      evidence: [{ jdQuote: 'Go', resumeQuote: 'Go' }],
    });

    const match = await repo.getMatch(env.DB, matchId);
    expect(match).toMatchObject({ outcome: 'passed', score: 88, app_status: 'new' });
    expect(JSON.parse(match!.evidence!)).toHaveLength(1);
  });

  it('stores a null score for an unscored posting rather than a zero', async () => {
    const [job] = await repo.insertNewJobs(env.DB, USER, 'jobicy', [posting(9, '')]);
    const matchId = await repo.insertMatch(env.DB, {
      userId: USER,
      runId,
      jobId: job!.id,
      outcome: 'insufficient_input',
      outcomeDetail: 'Description is 0 characters, below the 400 character floor',
      score: null,
      reason: null,
      evidence: null,
    });

    const match = await repo.getMatch(env.DB, matchId);
    expect(match!.score).toBeNull();
    expect(match!.outcome_detail).toContain('400 character floor');
  });

  it('builds a receipt that distinguishes every outcome', async () => {
    const jobs = await repo.insertNewJobs(env.DB, USER, 'jobicy', [
      posting(1),
      posting(2),
      posting(3),
      posting(4),
    ]);
    const outcomes = ['passed', 'rejected', 'insufficient_input', 'score_failed'] as const;
    for (let i = 0; i < outcomes.length; i++) {
      await repo.insertMatch(env.DB, {
        userId: USER,
        runId,
        jobId: jobs[i]!.id,
        outcome: outcomes[i]!,
        outcomeDetail: null,
        score: outcomes[i] === 'passed' ? 90 : outcomes[i] === 'rejected' ? 40 : null,
        reason: null,
        evidence: null,
      });
    }

    await repo.setRunCounts(env.DB, runId, { fetched: 10, newJobs: 4, unparseable: 1 });
    const receipt = await repo.getRunReceipt(env.DB, runId);

    expect(receipt).toMatchObject({
      fetched: 10,
      alreadySeen: 6,
      unparseable: 1,
      insufficient: 1,
      scored: 3,
      passed: 1,
      rejected: 1,
      scoreFailed: 1,
      topRejectedScore: 40,
    });
  });

  it('saves a tailored resume with its provenance report', async () => {
    const resume = await repo.saveResume(env.DB, USER, 'master body');
    const [job] = await repo.insertNewJobs(env.DB, USER, 'jobicy', [posting(1)]);
    const matchId = await repo.insertMatch(env.DB, {
      userId: USER,
      runId,
      jobId: job!.id,
      outcome: 'passed',
      outcomeDetail: null,
      score: 90,
      reason: 'good',
      evidence: [],
    });

    await repo.saveTailoredResume(env.DB, {
      matchId,
      userId: USER,
      sourceResumeId: resume.id,
      content: 'tailored body',
      provenance: { lines: [{ line: 'tailored body', status: 'verified', unsupported: [] }], unverifiedCount: 0 },
      model: MODEL,
    });

    const stored = await repo.getTailoredResume(env.DB, matchId);
    expect(stored).toMatchObject({ content: 'tailored body', unverified_count: 0, model: MODEL });
  });

  // The ledger records what was called, not what it cost. There is no price
  // table to multiply by, and the receipt is more useful stating work done
  // than stating a dollar figure the app would have to guess at.
  it('records model calls and rolls their tokens up for one run', async () => {
    await repo.recordUsage(env.DB, { userId: USER, runId, model: MODEL, purpose: 'score', tokensIn: 2000, tokensOut: 100 });
    await repo.recordUsage(env.DB, { userId: USER, runId, model: MODEL, purpose: 'tailor', tokensIn: 4000, tokensOut: 1200 });

    expect(await repo.sumRunUsage(env.DB, runId)).toEqual({ calls: 2, tokensIn: 6000, tokensOut: 1300 });
  });

  it('reports zero usage for a run that made no calls', async () => {
    const empty = await repo.createRun(env.DB, USER, 'manual');
    expect(await repo.sumRunUsage(env.DB, empty)).toEqual({ calls: 0, tokensIn: 0, tokensOut: 0 });
  });

  it('finishes a run with a status', async () => {
    await repo.finishRun(env.DB, runId, 'degraded', null);
    const run = await repo.getRun(env.DB, runId);
    expect(run).toMatchObject({ status: 'degraded' });
    expect(run!.finished_at).toBeGreaterThan(0);
  });

  it('finds only the users due in the current hour', async () => {
    await repo.savePrefs(env.DB, USER, { schedule_hour_utc: 9, schedule_enabled: 1 });
    expect(await repo.dueUsers(env.DB, 9)).toEqual([USER]);
    expect(await repo.dueUsers(env.DB, 10)).toEqual([]);

    await repo.savePrefs(env.DB, USER, { schedule_enabled: 0 });
    expect(await repo.dueUsers(env.DB, 9)).toEqual([]);
  });

  it('updates application status and calibration feedback', async () => {
    const [job] = await repo.insertNewJobs(env.DB, USER, 'jobicy', [posting(1)]);
    const matchId = await repo.insertMatch(env.DB, {
      userId: USER, runId, jobId: job!.id, outcome: 'passed',
      outcomeDetail: null, score: 90, reason: 'good', evidence: [],
    });

    await repo.setAppStatus(env.DB, matchId, 'applied');
    await repo.setFeedback(env.DB, matchId, false);

    const match = await repo.getMatch(env.DB, matchId);
    expect(match).toMatchObject({ app_status: 'applied', user_agrees: 0 });
  });
});
