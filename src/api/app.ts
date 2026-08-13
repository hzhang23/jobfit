import { Hono } from 'hono';
import type { Env } from '../env';
import { matches } from './routes/matches';
import { me } from './routes/me';
import { runs } from './routes/runs';

export function createApp() {
  const app = new Hono<{ Bindings: Env }>();

  app.route('/api', me);
  app.route('/api', runs);
  app.route('/api', matches);

  app.onError((error, c) => {
    console.error(error);
    return c.json({ error: String(error) }, 500);
  });

  return app;
}
