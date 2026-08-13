CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  email       TEXT UNIQUE,
  created_at  INTEGER NOT NULL
);

CREATE TABLE resumes (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  content     TEXT NOT NULL,
  version     INTEGER NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_resume_active ON resumes(user_id) WHERE is_active = 1;

CREATE TABLE search_prefs (
  user_id           TEXT PRIMARY KEY REFERENCES users(id),
  keywords          TEXT NOT NULL DEFAULT 'software engineer',
  geo               TEXT NOT NULL DEFAULT 'usa',
  min_score         INTEGER NOT NULL DEFAULT 70,
  max_jobs_per_run  INTEGER NOT NULL DEFAULT 10,
  schedule_enabled  INTEGER NOT NULL DEFAULT 1,
  schedule_hour_utc INTEGER NOT NULL DEFAULT 15
);

CREATE TABLE jobs (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  source       TEXT NOT NULL,
  external_id  TEXT NOT NULL,
  title        TEXT NOT NULL,
  company      TEXT NOT NULL,
  location     TEXT,
  url          TEXT NOT NULL,
  description  TEXT NOT NULL,
  posted_at    INTEGER,
  fetched_at   INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_job_dedupe ON jobs(user_id, source, external_id);

CREATE TABLE runs (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id),
  trigger           TEXT NOT NULL,
  status            TEXT NOT NULL,
  started_at        INTEGER NOT NULL,
  finished_at       INTEGER,
  error             TEXT,
  cost_usd          REAL NOT NULL DEFAULT 0,
  -- Receipt counters that cannot be derived from matches, because a posting
  -- that was already seen never produces a match row.
  fetched_count     INTEGER NOT NULL DEFAULT 0,
  new_count         INTEGER NOT NULL DEFAULT 0,
  unparseable_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_runs_user ON runs(user_id, started_at DESC);

CREATE TABLE matches (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  run_id         TEXT NOT NULL REFERENCES runs(id),
  job_id         TEXT NOT NULL REFERENCES jobs(id),
  outcome        TEXT NOT NULL,
  outcome_detail TEXT,
  score          INTEGER,
  reason         TEXT,
  evidence       TEXT,
  app_status     TEXT NOT NULL DEFAULT 'new',
  user_agrees    INTEGER,
  created_at     INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_match_job ON matches(job_id);
CREATE INDEX idx_match_run ON matches(run_id);
CREATE INDEX idx_match_user ON matches(user_id, created_at DESC);

CREATE TABLE tailored_resumes (
  id               TEXT PRIMARY KEY,
  match_id         TEXT NOT NULL UNIQUE REFERENCES matches(id),
  user_id          TEXT NOT NULL REFERENCES users(id),
  source_resume_id TEXT NOT NULL REFERENCES resumes(id),
  content          TEXT NOT NULL,
  provenance       TEXT NOT NULL,
  unverified_count INTEGER NOT NULL,
  model            TEXT NOT NULL,
  created_at       INTEGER NOT NULL
);

CREATE TABLE usage_ledger (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  run_id     TEXT,
  model      TEXT NOT NULL,
  purpose    TEXT NOT NULL,
  tokens_in  INTEGER NOT NULL,
  tokens_out INTEGER NOT NULL,
  cost_usd   REAL NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_usage_created ON usage_ledger(user_id, created_at DESC);
