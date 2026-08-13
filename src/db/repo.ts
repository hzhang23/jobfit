import type { AppStatus, EvidenceItem, MatchOutcome, RunStatus } from '../domain/types';
import type { ProvenanceReport } from '../domain/provenance';
import type { RawPosting } from '../sources/types';
import { newId } from './ids';

export interface ResumeRow {
  id: string;
  content: string;
  version: number;
}

export interface PrefsRow {
  user_id: string;
  keywords: string;
  geo: string;
  min_score: number;
  max_jobs_per_run: number;
  schedule_enabled: number;
  schedule_hour_utc: number;
}

export interface JobRow {
  id: string;
  user_id: string;
  source: string;
  external_id: string;
  title: string;
  company: string;
  location: string | null;
  url: string;
  description: string;
  posted_at: number | null;
  fetched_at: number;
}

export interface RunRow {
  id: string;
  user_id: string;
  trigger: string;
  status: RunStatus;
  started_at: number;
  finished_at: number | null;
  error: string | null;
  fetched_count: number;
  new_count: number;
  unparseable_count: number;
}

export interface MatchRow {
  id: string;
  user_id: string;
  run_id: string;
  job_id: string;
  outcome: MatchOutcome;
  outcome_detail: string | null;
  score: number | null;
  reason: string | null;
  evidence: string | null;
  app_status: AppStatus;
  user_agrees: number | null;
  created_at: number;
}

export interface TailoredResumeRow {
  id: string;
  match_id: string;
  user_id: string;
  source_resume_id: string;
  content: string;
  provenance: string;
  unverified_count: number;
  model: string;
  created_at: number;
}

export interface Receipt {
  fetched: number;
  alreadySeen: number;
  unparseable: number;
  insufficient: number;
  scored: number;
  passed: number;
  rejected: number;
  scoreFailed: number;
  /** Highest score among rejected postings. Lets the UI explain a zero-pass day. */
  topRejectedScore: number | null;
}

const now = () => Date.now();

// ---------------------------------------------------------------- resumes

export async function getActiveResume(
  db: D1Database,
  userId: string,
): Promise<ResumeRow | null> {
  return db
    .prepare('SELECT id, content, version FROM resumes WHERE user_id = ? AND is_active = 1')
    .bind(userId)
    .first<ResumeRow>();
}

export async function saveResume(
  db: D1Database,
  userId: string,
  content: string,
): Promise<ResumeRow> {
  const previous = await db
    .prepare('SELECT COALESCE(MAX(version), 0) AS v FROM resumes WHERE user_id = ?')
    .bind(userId)
    .first<{ v: number }>();

  const version = (previous?.v ?? 0) + 1;
  const id = newId('res');

  await db.batch([
    db.prepare('UPDATE resumes SET is_active = 0 WHERE user_id = ?').bind(userId),
    db
      .prepare(
        `INSERT INTO resumes (id, user_id, content, version, is_active, created_at)
         VALUES (?, ?, ?, ?, 1, ?)`,
      )
      .bind(id, userId, content, version, now()),
  ]);

  return { id, content, version };
}

// ------------------------------------------------------------------ prefs

export async function getPrefs(db: D1Database, userId: string): Promise<PrefsRow> {
  const row = await db
    .prepare('SELECT * FROM search_prefs WHERE user_id = ?')
    .bind(userId)
    .first<PrefsRow>();
  if (!row) throw new Error(`No preferences row for user ${userId}`);
  return row;
}

const PREF_COLUMNS = [
  'keywords',
  'geo',
  'min_score',
  'max_jobs_per_run',
  'schedule_enabled',
  'schedule_hour_utc',
] as const;

export type PrefsPatch = Partial<Pick<PrefsRow, (typeof PREF_COLUMNS)[number]>>;

export async function savePrefs(
  db: D1Database,
  userId: string,
  patch: PrefsPatch,
): Promise<PrefsRow> {
  const entries = PREF_COLUMNS.filter((c) => patch[c] !== undefined).map(
    (c) => [c, patch[c]] as const,
  );

  if (entries.length > 0) {
    const setClause = entries.map(([c]) => `${c} = ?`).join(', ');
    await db
      .prepare(`UPDATE search_prefs SET ${setClause} WHERE user_id = ?`)
      .bind(...entries.map(([, v]) => v as string | number), userId)
      .run();
  }

  return getPrefs(db, userId);
}

export async function dueUsers(db: D1Database, hourUtc: number): Promise<string[]> {
  const { results } = await db
    .prepare(
      'SELECT user_id FROM search_prefs WHERE schedule_enabled = 1 AND schedule_hour_utc = ?',
    )
    .bind(hourUtc)
    .all<{ user_id: string }>();
  return results.map((r) => r.user_id);
}

// ------------------------------------------------------------------- jobs

/**
 * Deduplication is the unique index, not a pipeline stage. RETURNING gives us
 * exactly the rows that were new, so nothing downstream has to guess.
 */
export async function insertNewJobs(
  db: D1Database,
  userId: string,
  source: string,
  postings: RawPosting[],
): Promise<JobRow[]> {
  if (postings.length === 0) return [];

  const fetchedAt = now();
  const statements = postings.map((p) =>
    db
      .prepare(
        `INSERT INTO jobs (id, user_id, source, external_id, title, company, location, url, description, posted_at, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, source, external_id) DO NOTHING
         RETURNING *`,
      )
      .bind(
        newId('job'),
        userId,
        source,
        p.sourceId,
        p.title,
        p.company,
        p.location,
        p.url,
        p.description,
        p.postedAt,
        fetchedAt,
      ),
  );

  const batched = await db.batch<JobRow>(statements);
  return batched.flatMap((r) => r.results ?? []);
}

export async function getJob(db: D1Database, jobId: string): Promise<JobRow | null> {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').bind(jobId).first<JobRow>();
}

// ------------------------------------------------------------------- runs

export async function createRun(
  db: D1Database,
  userId: string,
  trigger: 'schedule' | 'manual',
): Promise<string> {
  const id = newId('run');
  await db
    .prepare(
      `INSERT INTO runs (id, user_id, trigger, status, started_at) VALUES (?, ?, ?, 'running', ?)`,
    )
    .bind(id, userId, trigger, now())
    .run();
  return id;
}

export async function setRunCounts(
  db: D1Database,
  runId: string,
  counts: { fetched: number; newJobs: number; unparseable: number },
): Promise<void> {
  await db
    .prepare(
      'UPDATE runs SET fetched_count = ?, new_count = ?, unparseable_count = ? WHERE id = ?',
    )
    .bind(counts.fetched, counts.newJobs, counts.unparseable, runId)
    .run();
}

export async function finishRun(
  db: D1Database,
  runId: string,
  status: RunStatus,
  error: string | null,
): Promise<void> {
  await db
    .prepare('UPDATE runs SET status = ?, error = ?, finished_at = ? WHERE id = ?')
    .bind(status, error, now(), runId)
    .run();
}

export async function getRun(db: D1Database, runId: string): Promise<RunRow | null> {
  return db.prepare('SELECT * FROM runs WHERE id = ?').bind(runId).first<RunRow>();
}

export async function listRuns(
  db: D1Database,
  userId: string,
  limit = 20,
): Promise<RunRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM runs WHERE user_id = ? ORDER BY started_at DESC LIMIT ?')
    .bind(userId, limit)
    .all<RunRow>();
  return results;
}

/**
 * The run receipt. This is why every posting gets a match row, including the
 * dropped ones. A zero-pass day and a broken fetch must not look alike.
 */
export async function getRunReceipt(db: D1Database, runId: string): Promise<Receipt> {
  const run = await getRun(db, runId);
  if (!run) throw new Error(`No run ${runId}`);

  const { results } = await db
    .prepare(
      'SELECT outcome, COUNT(*) AS n, MAX(score) AS top FROM matches WHERE run_id = ? GROUP BY outcome',
    )
    .bind(runId)
    .all<{ outcome: MatchOutcome; n: number; top: number | null }>();

  const by = (o: MatchOutcome) => results.find((r) => r.outcome === o);
  const count = (o: MatchOutcome) => by(o)?.n ?? 0;

  return {
    fetched: run.fetched_count,
    alreadySeen: run.fetched_count - run.new_count,
    unparseable: run.unparseable_count,
    insufficient: count('insufficient_input'),
    scored: count('passed') + count('rejected') + count('score_failed'),
    passed: count('passed'),
    rejected: count('rejected'),
    scoreFailed: count('score_failed'),
    topRejectedScore: by('rejected')?.top ?? null,
  };
}

// ---------------------------------------------------------------- matches

export async function insertMatch(
  db: D1Database,
  m: {
    userId: string;
    runId: string;
    jobId: string;
    outcome: MatchOutcome;
    outcomeDetail: string | null;
    score: number | null;
    reason: string | null;
    evidence: EvidenceItem[] | null;
  },
): Promise<string> {
  const id = newId('mch');
  await db
    .prepare(
      `INSERT INTO matches (id, user_id, run_id, job_id, outcome, outcome_detail, score, reason, evidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      m.userId,
      m.runId,
      m.jobId,
      m.outcome,
      m.outcomeDetail,
      m.score,
      m.reason,
      m.evidence ? JSON.stringify(m.evidence) : null,
      now(),
    )
    .run();
  return id;
}

export async function getMatch(db: D1Database, matchId: string): Promise<MatchRow | null> {
  return db.prepare('SELECT * FROM matches WHERE id = ?').bind(matchId).first<MatchRow>();
}

export interface MatchWithJob extends MatchRow {
  title: string;
  company: string;
  location: string | null;
  url: string;
  posted_at: number | null;
}

export async function listMatches(
  db: D1Database,
  userId: string,
  filter: { outcome?: MatchOutcome; appStatus?: AppStatus; limit?: number } = {},
): Promise<MatchWithJob[]> {
  const clauses = ['m.user_id = ?'];
  const binds: (string | number)[] = [userId];

  if (filter.outcome) {
    clauses.push('m.outcome = ?');
    binds.push(filter.outcome);
  }
  if (filter.appStatus) {
    clauses.push('m.app_status = ?');
    binds.push(filter.appStatus);
  }
  binds.push(filter.limit ?? 100);

  const { results } = await db
    .prepare(
      `SELECT m.*, j.title, j.company, j.location, j.url, j.posted_at
       FROM matches m JOIN jobs j ON j.id = m.job_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY m.score DESC NULLS LAST, m.created_at DESC
       LIMIT ?`,
    )
    .bind(...binds)
    .all<MatchWithJob>();

  return results;
}

export async function setAppStatus(
  db: D1Database,
  matchId: string,
  status: AppStatus,
): Promise<void> {
  await db.prepare('UPDATE matches SET app_status = ? WHERE id = ?').bind(status, matchId).run();
}

export async function setFeedback(
  db: D1Database,
  matchId: string,
  agrees: boolean,
): Promise<void> {
  await db
    .prepare('UPDATE matches SET user_agrees = ? WHERE id = ?')
    .bind(agrees ? 1 : 0, matchId)
    .run();
}

// ------------------------------------------------------- tailored resumes

export async function saveTailoredResume(
  db: D1Database,
  t: {
    matchId: string;
    userId: string;
    sourceResumeId: string;
    content: string;
    provenance: ProvenanceReport;
    model: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO tailored_resumes (id, match_id, user_id, source_resume_id, content, provenance, unverified_count, model, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      newId('tld'),
      t.matchId,
      t.userId,
      t.sourceResumeId,
      t.content,
      JSON.stringify(t.provenance),
      t.provenance.unverifiedCount,
      t.model,
      now(),
    )
    .run();
}

export async function getTailoredResume(
  db: D1Database,
  matchId: string,
): Promise<TailoredResumeRow | null> {
  return db
    .prepare('SELECT * FROM tailored_resumes WHERE match_id = ?')
    .bind(matchId)
    .first<TailoredResumeRow>();
}

// ------------------------------------------------------------------ usage

export async function recordUsage(
  db: D1Database,
  u: {
    userId: string;
    runId: string | null;
    model: string;
    purpose: 'score' | 'tailor';
    tokensIn: number;
    tokensOut: number;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO usage_ledger (id, user_id, run_id, model, purpose, tokens_in, tokens_out, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(newId('use'), u.userId, u.runId, u.model, u.purpose, u.tokensIn, u.tokensOut, now())
    .run();
}

/**
 * Records what happened to a match after its score was already stored. The one
 * current caller is the tailoring step, which can fail or be refused by the
 * per-run call cap well after the score is durable.
 *
 * A passed match leaves outcome_detail null, so the column is free for this. A
 * match with no tailored resume and no note is indistinguishable from one that
 * was never attempted, and a user reading that page cannot tell the difference
 * between "the writer failed" and "nothing happened here". That is failure
 * mode 3, silence read as a signal.
 */
export async function setOutcomeDetail(
  db: D1Database,
  matchId: string,
  detail: string,
): Promise<void> {
  await db
    .prepare('UPDATE matches SET outcome_detail = ? WHERE id = ?')
    .bind(detail.slice(0, 500), matchId)
    .run();
}

export interface RunUsage {
  calls: number;
  tokensIn: number;
  tokensOut: number;
}

/**
 * What the run actually asked the model to do. Reported on the receipt in
 * place of a spend figure, because the app has no honest way to produce a
 * spend figure and a dishonest one is worse than none.
 */
export async function sumRunUsage(db: D1Database, runId: string): Promise<RunUsage> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS calls,
              COALESCE(SUM(tokens_in), 0)  AS tokensIn,
              COALESCE(SUM(tokens_out), 0) AS tokensOut
       FROM usage_ledger WHERE run_id = ?`,
    )
    .bind(runId)
    .first<RunUsage>();
  return row ?? { calls: 0, tokensIn: 0, tokensOut: 0 };
}
