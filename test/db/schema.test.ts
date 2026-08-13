import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('schema', () => {
  it('creates all eight tables', async () => {
    // applyD1Migrations keeps its own bookkeeping table called d1_migrations,
    // the same name wrangler uses in production. Exclude it by name rather
    // than renaming it, so the test environment matches the real one.
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations' ORDER BY name",
    ).all<{ name: string }>();

    expect(results.map((r) => r.name)).toEqual([
      'jobs',
      'matches',
      'resumes',
      'runs',
      'search_prefs',
      'tailored_resumes',
      'usage_ledger',
      'users',
    ]);
  });

  it('seeds exactly one user with default preferences', async () => {
    const prefs = await env.DB.prepare(
      'SELECT user_id, min_score, max_jobs_per_run, schedule_hour_utc FROM search_prefs',
    ).all<{
      user_id: string;
      min_score: number;
      max_jobs_per_run: number;
      schedule_hour_utc: number;
    }>();

    expect(prefs.results).toEqual([
      {
        user_id: 'local-user',
        min_score: 70,
        max_jobs_per_run: 10,
        schedule_hour_utc: 15,
      },
    ]);
  });

  it('rejects a duplicate posting from the same source', async () => {
    const insert = (id: string) =>
      env.DB.prepare(
        `INSERT INTO jobs (id, user_id, source, external_id, title, company, location, url, description, posted_at, fetched_at)
         VALUES (?, 'local-user', 'jobicy', 'ext-1', 'Engineer', 'Acme', 'usa', 'https://x', 'desc', NULL, 0)`,
      )
        .bind(id)
        .run();

    await insert('job_a');
    await expect(insert('job_b')).rejects.toThrow(/UNIQUE/i);
  });

  it('allows only one active resume per user', async () => {
    const insert = (id: string) =>
      env.DB.prepare(
        `INSERT INTO resumes (id, user_id, content, version, is_active, created_at)
         VALUES (?, 'local-user', 'body', 1, 1, 0)`,
      )
        .bind(id)
        .run();

    await insert('res_a');
    await expect(insert('res_b')).rejects.toThrow(/UNIQUE/i);
  });
});
