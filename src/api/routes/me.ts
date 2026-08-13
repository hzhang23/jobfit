import { Hono } from 'hono';
import { getCurrentUser } from '../../auth';
import * as repo from '../../db/repo';
import type { Env } from '../../env';

export const me = new Hono<{ Bindings: Env }>();

me.get('/me', async (c) => {
  const userId = getCurrentUser(c.req.raw);
  const [prefs, resume] = await Promise.all([
    repo.getPrefs(c.env.DB, userId),
    repo.getActiveResume(c.env.DB, userId),
  ]);

  return c.json({
    userId,
    prefs,
    resume: resume
      ? { id: resume.id, version: resume.version, charCount: resume.content.length }
      : null,
  });
});

me.put('/resume', async (c) => {
  const body = await c.req.json<{ content?: unknown }>();
  const content = typeof body.content === 'string' ? body.content : '';
  if (!content.trim()) {
    return c.json({ error: 'Resume content cannot be empty' }, 400);
  }

  const saved = await repo.saveResume(c.env.DB, getCurrentUser(c.req.raw), content);
  return c.json({ id: saved.id, version: saved.version });
});

me.put('/prefs', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const patch: repo.PrefsPatch = {};

  if (typeof body.keywords === 'string') patch.keywords = body.keywords.trim();
  if (typeof body.geo === 'string') patch.geo = body.geo.trim();

  if (body.min_score !== undefined) {
    const n = Number(body.min_score);
    if (!Number.isInteger(n) || n < 0 || n > 100) {
      return c.json({ error: 'min_score must be an integer from 0 to 100' }, 400);
    }
    patch.min_score = n;
  }

  if (body.max_jobs_per_run !== undefined) {
    const n = Number(body.max_jobs_per_run);
    if (!Number.isInteger(n) || n < 1 || n > 50) {
      return c.json({ error: 'max_jobs_per_run must be an integer from 1 to 50' }, 400);
    }
    patch.max_jobs_per_run = n;
  }

  if (body.schedule_hour_utc !== undefined) {
    const n = Number(body.schedule_hour_utc);
    if (!Number.isInteger(n) || n < 0 || n > 23) {
      return c.json({ error: 'schedule_hour_utc must be an integer from 0 to 23' }, 400);
    }
    patch.schedule_hour_utc = n;
  }

  if (body.schedule_enabled !== undefined) {
    patch.schedule_enabled = body.schedule_enabled ? 1 : 0;
  }

  return c.json(await repo.savePrefs(c.env.DB, getCurrentUser(c.req.raw), patch));
});
