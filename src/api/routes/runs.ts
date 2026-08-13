import { Hono } from 'hono';
import { getCurrentUser } from '../../auth';
import * as repo from '../../db/repo';
import type { Env } from '../../env';

export const runs = new Hono<{ Bindings: Env }>();

runs.post('/runs', async (c) => {
  const userId = getCurrentUser(c.req.raw);

  // No spend precheck. The app does not know what it has spent, and guessing
  // would be the manufactured-confidence pattern this build exists to avoid.
  // Cloudflare refuses the call when the account is over quota, and the
  // pipeline records that refusal as a run outcome the receipt can show.
  const runId = await repo.createRun(c.env.DB, userId, 'manual');
  await c.env.JOB_RUN.create({ params: { userId, trigger: 'manual', runId } });

  // 202 immediately. The work is asynchronous and the client polls the run.
  return c.json({ runId }, 202);
});

runs.get('/runs', async (c) => {
  return c.json(await repo.listRuns(c.env.DB, getCurrentUser(c.req.raw), 20));
});

runs.get('/runs/:id', async (c) => {
  const userId = getCurrentUser(c.req.raw);
  const run = await repo.getRun(c.env.DB, c.req.param('id'));
  // Scoped to the current user, not just existence. A run id that exists but
  // belongs to someone else must read as 404, the same as one that does not
  // exist at all, so this handler never confirms another user's data.
  if (!run || run.user_id !== userId) return c.json({ error: 'No such run' }, 404);
  const [receipt, usage] = await Promise.all([
    repo.getRunReceipt(c.env.DB, run.id),
    repo.sumRunUsage(c.env.DB, run.id),
  ]);
  return c.json({ ...run, receipt, usage });
});
