import { type Context, Hono } from 'hono';
import type { Env } from '../env';
import { matches } from './routes/matches';
import { me } from './routes/me';
import { runs } from './routes/runs';

/**
 * Parses a JSON body, returning null instead of throwing.
 *
 * `c.req.json()` throws a SyntaxError on a malformed body. Unhandled, that
 * reaches the app level onError and comes back as a 500 carrying the raw
 * parser message, so a caller's typo is reported as a server fault and the
 * internals are handed out with it. A malformed request is a 400.
 */
export async function readJson<T>(c: Context): Promise<T | null> {
  try {
    return (await c.req.json()) as T;
  } catch {
    return null;
  }
}

export const BAD_JSON = { error: 'Request body must be valid JSON' } as const;

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
