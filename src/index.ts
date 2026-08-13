import { createApp } from './api/app';
import * as repo from './db/repo';
import type { Env } from './env';

export { JobRunWorkflow } from './workflow/run';

const app = createApp();

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return app.fetch(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },

  /**
   * Fires hourly. Each user stores the hour they want, so one cron expression
   * covers every timezone instead of twenty four.
   */
  async scheduled(event: ScheduledController, env: Env): Promise<void> {
    const hour = new Date(event.scheduledTime).getUTCHours();

    for (const userId of await repo.dueUsers(env.DB, hour)) {
      const runId = await repo.createRun(env.DB, userId, 'schedule');
      await env.JOB_RUN.create({ params: { userId, trigger: 'schedule', runId } });
    }
  },
};
