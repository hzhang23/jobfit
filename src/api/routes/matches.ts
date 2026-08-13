import { Hono } from 'hono';
import { getCurrentUser } from '../../auth';
import * as repo from '../../db/repo';
import { type ProvenanceReport, verifiedOnly } from '../../domain/provenance';
import type { AppStatus, MatchOutcome } from '../../domain/types';
import type { Env } from '../../env';
import { BAD_JSON, readJson } from '../app';

export const matches = new Hono<{ Bindings: Env }>();

const OUTCOMES: MatchOutcome[] = ['insufficient_input', 'rejected', 'passed', 'score_failed'];
const STATUSES: AppStatus[] = ['new', 'interested', 'applied', 'rejected'];

matches.get('/matches', async (c) => {
  const outcome = c.req.query('outcome');
  const appStatus = c.req.query('status');

  return c.json(
    await repo.listMatches(c.env.DB, getCurrentUser(c.req.raw), {
      outcome: OUTCOMES.includes(outcome as MatchOutcome) ? (outcome as MatchOutcome) : undefined,
      appStatus: STATUSES.includes(appStatus as AppStatus) ? (appStatus as AppStatus) : undefined,
      limit: Number(c.req.query('limit')) || 100,
    }),
  );
});

matches.get('/matches/:id', async (c) => {
  const userId = getCurrentUser(c.req.raw);
  const match = await repo.getMatch(c.env.DB, c.req.param('id'));
  // Scoped to the current user. repo.getMatch looks up by id alone, so the
  // ownership check has to happen here, otherwise a foreign match id would
  // return someone else's data instead of a 404.
  if (!match || match.user_id !== userId) return c.json({ error: 'No such match' }, 404);

  const job = await repo.getJob(c.env.DB, match.job_id);
  return c.json({
    ...match,
    evidence: match.evidence ? JSON.parse(match.evidence) : [],
    job,
    hasTailoredResume: Boolean(await repo.getTailoredResume(c.env.DB, match.id)),
  });
});

matches.post('/matches/:id/status', async (c) => {
  const userId = getCurrentUser(c.req.raw);
  const match = await repo.getMatch(c.env.DB, c.req.param('id'));
  if (!match || match.user_id !== userId) return c.json({ error: 'No such match' }, 404);

  const body = await readJson<{ status?: string }>(c);
  if (!body) return c.json(BAD_JSON, 400);
  const { status } = body;
  if (!STATUSES.includes(status as AppStatus)) {
    return c.json({ error: `status must be one of ${STATUSES.join(', ')}` }, 400);
  }
  await repo.setAppStatus(c.env.DB, match.id, status as AppStatus);
  return c.json({ ok: true });
});

matches.post('/matches/:id/feedback', async (c) => {
  const userId = getCurrentUser(c.req.raw);
  const match = await repo.getMatch(c.env.DB, c.req.param('id'));
  if (!match || match.user_id !== userId) return c.json({ error: 'No such match' }, 404);

  const body = await readJson<{ agrees?: unknown }>(c);
  if (!body) return c.json(BAD_JSON, 400);
  const { agrees } = body;
  if (typeof agrees !== 'boolean') {
    return c.json({ error: 'agrees must be a boolean' }, 400);
  }
  await repo.setFeedback(c.env.DB, match.id, agrees);
  return c.json({ ok: true });
});

matches.get('/matches/:id/resume', async (c) => {
  const userId = getCurrentUser(c.req.raw);
  const tailored = await repo.getTailoredResume(c.env.DB, c.req.param('id'));
  // Scoped to the current user via the tailored resume's own user_id, since
  // repo.getTailoredResume looks up by match id alone.
  if (!tailored || tailored.user_id !== userId) {
    return c.json({ error: 'No tailored resume for this match' }, 404);
  }

  const report = JSON.parse(tailored.provenance) as ProvenanceReport;
  return c.json({
    content: tailored.content,
    model: tailored.model,
    unverifiedCount: report.unverifiedCount,
    lines: report.lines,
  });
});

/**
 * The default is include=verified. Unverified lines do not leave the system
 * unless the caller explicitly asks for them.
 */
matches.get('/matches/:id/resume/export', async (c) => {
  const userId = getCurrentUser(c.req.raw);
  const tailored = await repo.getTailoredResume(c.env.DB, c.req.param('id'));
  if (!tailored || tailored.user_id !== userId) {
    return c.json({ error: 'No tailored resume for this match' }, 404);
  }

  const report = JSON.parse(tailored.provenance) as ProvenanceReport;
  const body = c.req.query('include') === 'all' ? tailored.content : verifiedOnly(report);

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'content-disposition': `attachment; filename="resume-${c.req.param('id')}.txt"`,
    },
  });
});
