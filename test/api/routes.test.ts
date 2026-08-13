import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/api/app';
import * as repo from '../../src/db/repo';

const USER = 'local-user';
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

function testEnv(overrides: Partial<typeof env> = {}) {
  return {
    ...env,
    JOB_RUN: { create: vi.fn(async () => ({ id: 'wf-1' })) } as unknown as Workflow,
    ...overrides,
  };
}

const app = createApp();
const call = (path: string, init?: RequestInit, e = testEnv()) =>
  app.fetch(new Request(`https://test.local${path}`, init), e);

const json = (body: unknown): RequestInit => ({
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

describe('API', () => {
  beforeEach(async () => {
    await repo.saveResume(env.DB, USER, 'Ricky Zhang\nBuilt services in Go');
  });

  it('GET /api/me returns prefs and a resume summary', async () => {
    const body = await (await call('/api/me')).json<{ prefs: { min_score: number }; resume: { version: number; charCount: number } }>();
    expect(body.prefs.min_score).toBe(70);
    expect(body.resume.version).toBe(1);
    expect(body.resume.charCount).toBeGreaterThan(0);
  });

  it('PUT /api/resume saves a new version', async () => {
    const res = await call('/api/resume', json({ content: 'new body' }));
    expect(res.status).toBe(200);
    expect((await repo.getActiveResume(env.DB, USER))!.content).toBe('new body');
  });

  it('PUT /api/resume rejects an empty body', async () => {
    const res = await call('/api/resume', json({ content: '   ' }));
    expect(res.status).toBe(400);
  });

  it('PUT /api/prefs applies a partial update', async () => {
    const res = await call('/api/prefs', json({ min_score: 60 }));
    expect(res.status).toBe(200);
    expect((await repo.getPrefs(env.DB, USER)).min_score).toBe(60);
  });

  it('PUT /api/prefs rejects a threshold outside 0 to 100', async () => {
    expect((await call('/api/prefs', json({ min_score: 200 }))).status).toBe(400);
  });

  it('POST /api/runs returns 202 with a run id and spawns the workflow', async () => {
    const e = testEnv();
    const res = await call('/api/runs', { method: 'POST' }, e);

    expect(res.status).toBe(202);
    const body = await res.json<{ runId: string }>();
    expect(body.runId).toMatch(/^run_/);
    expect(e.JOB_RUN.create).toHaveBeenCalledOnce();
    expect((await repo.getRun(env.DB, body.runId))!.status).toBe('running');
  });

  it('GET /api/runs/:id returns the receipt', async () => {
    const runId = await repo.createRun(env.DB, USER, 'manual');
    await repo.setRunCounts(env.DB, runId, { fetched: 5, newJobs: 2, unparseable: 0 });
    await repo.finishRun(env.DB, runId, 'succeeded', null);

    const body = await (await call(`/api/runs/${runId}`)).json<{ status: string; receipt: { alreadySeen: number } }>();
    expect(body.status).toBe('succeeded');
    expect(body.receipt.alreadySeen).toBe(3);
  });

  it('GET /api/runs/:id is 404 for an unknown run', async () => {
    expect((await call('/api/runs/run_nope')).status).toBe(404);
  });

  describe('matches', () => {
    let matchId: string;

    beforeEach(async () => {
      const runId = await repo.createRun(env.DB, USER, 'manual');
      const [job] = await repo.insertNewJobs(env.DB, USER, 'jobicy', [
        {
          sourceId: 'e1',
          title: 'Backend Engineer',
          company: 'Acme',
          location: 'usa',
          url: 'https://example.com/1',
          description: 'long description',
          postedAt: 1_700_000_000_000,
        },
      ]);
      matchId = await repo.insertMatch(env.DB, {
        userId: USER, runId, jobId: job!.id, outcome: 'passed',
        outcomeDetail: null, score: 88, reason: 'Overlap on Go',
        evidence: [{ jdQuote: 'Go', resumeQuote: 'Go' }],
      });
      await repo.saveTailoredResume(env.DB, {
        matchId,
        userId: USER,
        sourceResumeId: (await repo.getActiveResume(env.DB, USER))!.id,
        content: 'Built services in Go\nLed 99 engineers at Stripe',
        provenance: {
          lines: [
            { line: 'Built services in Go', status: 'verified', unsupported: [] },
            { line: 'Led 99 engineers at Stripe', status: 'unverified', unsupported: ['99', 'Stripe'] },
          ],
          unverifiedCount: 1,
        },
        model: MODEL,
      });
    });

    it('lists matches with their job fields', async () => {
      const body = await (await call('/api/matches?outcome=passed')).json<Array<{ title: string; score: number }>>();
      expect(body[0]).toMatchObject({ title: 'Backend Engineer', score: 88 });
    });

    it('returns detail with parsed evidence', async () => {
      const body = await (await call(`/api/matches/${matchId}`)).json<{ evidence: unknown[] }>();
      expect(body.evidence).toHaveLength(1);
    });

    it('returns the tailored resume with its provenance lines', async () => {
      const body = await (await call(`/api/matches/${matchId}/resume`)).json<{ unverifiedCount: number; lines: unknown[] }>();
      expect(body.unverifiedCount).toBe(1);
      expect(body.lines).toHaveLength(2);
    });

    // The default is the product-layer response: unverified lines do not leave
    // the system unless the caller explicitly asks for them.
    it('exports only verified lines by default', async () => {
      const text = await (await call(`/api/matches/${matchId}/resume/export`)).text();
      expect(text).toBe('Built services in Go');
      expect(text).not.toContain('Stripe');
    });

    it('exports everything only when asked explicitly', async () => {
      const text = await (await call(`/api/matches/${matchId}/resume/export?include=all`)).text();
      expect(text).toContain('Stripe');
    });

    it('records application status and calibration feedback', async () => {
      const post = (path: string, body: unknown) =>
        call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

      expect((await post(`/api/matches/${matchId}/status`, { status: 'applied' })).status).toBe(200);
      expect((await post(`/api/matches/${matchId}/feedback`, { agrees: false })).status).toBe(200);

      const match = await repo.getMatch(env.DB, matchId);
      expect(match).toMatchObject({ app_status: 'applied', user_agrees: 0 });
    });

    it('rejects an unknown application status', async () => {
      const res = await call(`/api/matches/${matchId}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'ghosted' }),
      });
      expect(res.status).toBe(400);
    });
  });
});
