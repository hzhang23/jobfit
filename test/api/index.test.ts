import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import worker from '../../src/index';
import * as repo from '../../src/db/repo';

const USER = 'local-user';
const OTHER = 'other-user';

function fakeJobRun() {
  // An object with a `create` method, not a bare function cast to the binding
  // type. A bare function type checks against `Workflow` but throws at
  // runtime the moment `.create` is looked up, which would make a test
  // asserting "no work happened" pass for the wrong reason.
  return { create: vi.fn(async () => ({ id: 'wf-1' })) } as unknown as Workflow;
}

async function seedOtherUser(hourUtc: number) {
  await env.DB.batch([
    env.DB.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').bind(
      OTHER,
      'other@jobfit.dev',
      Date.now(),
    ),
    env.DB
      .prepare(
        'INSERT INTO search_prefs (user_id, schedule_hour_utc, schedule_enabled) VALUES (?, ?, 1)',
      )
      .bind(OTHER, hourUtc),
  ]);
}

describe('Worker entry points', () => {
  it('scheduled spawns one workflow per due user and none for a user due at another hour', async () => {
    await repo.savePrefs(env.DB, USER, { schedule_hour_utc: 9, schedule_enabled: 1 });
    await seedOtherUser(10);

    const jobRun = fakeJobRun();
    const testEnv = { ...env, JOB_RUN: jobRun };

    await worker.scheduled(
      createScheduledController({ scheduledTime: new Date(Date.UTC(2026, 0, 1, 9, 0, 0)) }),
      testEnv,
    );

    const dueRuns = await repo.listRuns(env.DB, USER, 20);
    expect(dueRuns).toHaveLength(1);
    expect(jobRun.create).toHaveBeenCalledOnce();
    expect(jobRun.create).toHaveBeenCalledWith({
      params: { userId: USER, trigger: 'schedule', runId: dueRuns[0]!.id },
    });

    expect(await repo.listRuns(env.DB, OTHER, 20)).toHaveLength(0);
  });

  it('scheduled does not run the pipeline itself', async () => {
    await repo.savePrefs(env.DB, USER, { schedule_hour_utc: 11, schedule_enabled: 1 });

    const jobRun = fakeJobRun();
    const testEnv = { ...env, JOB_RUN: jobRun };

    await worker.scheduled(
      createScheduledController({ scheduledTime: new Date(Date.UTC(2026, 0, 1, 11, 0, 0)) }),
      testEnv,
    );

    expect(jobRun.create).toHaveBeenCalledOnce();
    // No matches exist because only the pipeline, run by the Workflow itself,
    // ever creates them. The scheduled handler only selects users and spawns
    // the Workflow instance.
    expect(await repo.listMatches(env.DB, USER)).toHaveLength(0);
  });

  // Regression test for the ASSETS crash: env.ASSETS is dereferenced with no
  // guard and no assets binding is declared anywhere yet, so a non-api
  // request used to throw a raw TypeError outside Hono's error handler.
  it('returns 503 with a message when no assets binding is configured', async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request('https://test.local/'), env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(503);
    const body = await res.text();
    expect(body).toContain('build:web');
  });

  it('routes a request under /api/ to the Hono app rather than to assets', async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request('https://test.local/api/me'), env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const body = await res.json<{ prefs: { min_score: number } }>();
    expect(body.prefs.min_score).toBeTypeOf('number');
  });
});
