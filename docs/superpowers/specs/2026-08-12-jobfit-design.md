# JobFit: Design Spec

**Date:** 2026-08-12
**Status:** Approved, ready for implementation planning
**Context:** Module 4 build. Rewrites the Module 3 n8n pipeline as a code-based web app on Cloudflare.

---

## 0. What this is

JobFit fetches job postings on a schedule, scores each one against your resume with a stated reason, writes a tailored resume for the ones that clear a threshold, and shows you the shortlist.

It is a rewrite of a working n8n workflow. The n8n version ran successfully on 2026-07-31: 20 postings fetched, 10 scored, 4 cleared the gate, 4 tailored resumes written. This rewrite exists because the n8n version had one structural weakness that no amount of node configuration could fix. When the upstream data source silently returned empty job descriptions, every node stayed green and the AI scored every posting confidently from a job title alone. The workflow had no place to put the sentence "I could not evaluate this."

Everything in this design follows from that. The organizing constraint is not scale. It is trust.

---

## 1. Requirements

### 1.1 Functional

1. Maintain one master resume as plain text, editable, versioned.
2. Set search preferences: keywords, geography, score threshold, daily run hour.
3. Fetch job postings daily on a schedule, and on demand from a button.
4. Score each posting against the resume. Every score carries a reason and cited evidence.
5. Generate a tailored resume for postings above the threshold. Every tailored resume carries line level provenance.
6. Show a dashboard: ranked matches, scores, reasons, and a receipt for each run.
7. Export a tailored resume.
8. Track application status per match.

Requirements 4 and 5 state output contracts, not quality goals. A score without a reason, or a tailored resume without provenance, is an invalid output in this system rather than a low quality one.

### 1.2 Out of scope for v1

| Not building | Seam left behind |
|---|---|
| Auth, signup, invite codes, quotas | Every table carries `user_id`. Code calls `getCurrentUser()`, which returns a fixed local user in v1 |
| Auto apply, auto email | No seam. Deliberate, see Section 6 A4 |
| Google Docs and Sheets sync | Export is dispatched by format, so an adapter can be added |
| Additional job sources | `JobSource` interface is defined. Jobicy is the only implementation |
| Native mobile | Responsive layout is enough |

### 1.3 Non-functional, in priority order

1. **Under-report rather than mis-report.** No AI judgment derived from insufficient input may reach the interface. This outranks coverage.
2. **Every AI output is auditable.** A score traces to specific passages in the job description. A resume line traces to the master resume.
3. Dashboard read p95 under 500 ms.
4. A full run over 10 postings completes in under 4 minutes, asynchronously, with no user waiting.
5. **Runs are resumable.** A failure on posting 7 must not discard the work done on postings 1 through 6.
6. **The app holds no model provider secret, and does not compute what a run costs.** Spend is the provider's to meter and refuse. What is enforced locally is a bound on how many model calls one run may make.
7. Availability is explicitly not a goal. This is a personal tool. A failed run that retries tomorrow is acceptable.

### 1.4 Capacity estimate

| Quantity | Value |
|---|---|
| Users | 1 in v1, designed for 20 |
| Postings per user per day | 10 to 30 |
| Peak write rate | 600 rows per day, about 0.007 QPS |
| Job description size | roughly 5 KB |
| Annual data growth | about 1 GB against a 10 GB D1 limit |

The conclusion matters more than the numbers. **This system has no scale problem.** There is no sharding question, no cache tier, no read replica discussion. Stating that up front is what licenses the rest of this document to spend all of its attention on correctness and cost.

---

## 2. Core entities

Eight tables. One of them carries the design.

```sql
CREATE TABLE matches (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  run_id         TEXT NOT NULL,
  job_id         TEXT NOT NULL,
  outcome        TEXT NOT NULL,   -- insufficient_input | rejected | passed | score_failed
  outcome_detail TEXT,            -- why it was dropped, rendered in the UI
  score          INTEGER,         -- NULL when outcome = insufficient_input, never 0
  reason         TEXT,
  evidence       TEXT,            -- JSON: [{jdQuote, resumeQuote}]
  app_status     TEXT NOT NULL DEFAULT 'new',
  user_agrees    INTEGER,         -- calibration: 1 agree, 0 disagree, NULL unanswered
  created_at     INTEGER NOT NULL
);
```

**Every posting that enters a run leaves a row here, including the ones that were dropped.**

This is the sharpest difference from the n8n version. There, a posting filtered out by a dedupe node or an If node simply vanished, and its fate could only be inferred from a count badge on the canvas. Here it has a row, a name, and a reason.

`score` is `NULL` when the input was insufficient, not `0`. Zero is a judgment. NULL is the absence of one. Collapsing those two was the exact mechanism of the Module 3 failure: the system rendered "I do not know" as a confident number.

The remaining seven:

```sql
users            -- one row in v1. Reserved so auth is an additive change
resumes          -- master resume, versioned, partial unique index enforces one active
search_prefs     -- keywords, geo, min_score, max_jobs_per_run, schedule_hour_utc, enabled
jobs             -- UNIQUE(user_id, source, external_id)
runs             -- trigger, status, started_at, finished_at, error, cost_usd,
                 -- plus fetched_count, new_count, unparseable_count, which the
                 -- receipt needs because an already-seen posting makes no match row
tailored_resumes -- content, provenance JSON, unverified_count, model, source_resume_id
usage_ledger     -- one row per AI call: model, purpose, tokens_in, tokens_out, cost_usd
```

Two notes.

**Deduplication is a database constraint, not a pipeline stage.** `UNIQUE(user_id, source, external_id)` plus `INSERT OR IGNORE`. In the n8n version this was a cross-execution dedupe node that silently swallowed an entire test run and cost real debugging time. Here it is one line of DDL with no runtime behavior to misread.

**`usage_ledger` exists from day one**, not after costs become a problem. The latency budget and the cost tradeoff both need real numbers, and "vibes is not a method" applies to cost as much as to accuracy.

---

## 3. API

```
GET   /api/me                        -> user, prefs, active resume summary
PUT   /api/resume                    -> save master resume, auto increments version
PUT   /api/prefs                     -> keywords, geo, threshold, schedule

POST  /api/runs                      -> 202 {runId}, manual trigger, returns immediately
GET   /api/runs                      -> run receipts
GET   /api/runs/:id                  -> status and per stage counts, polled every 2s

GET   /api/matches?outcome=&status=  -> dashboard list
GET   /api/matches/:id               -> posting, score, reason, evidence
POST  /api/matches/:id/status        -> new | interested | applied | rejected
POST  /api/matches/:id/feedback      -> {agrees: bool}, calibration loop

GET   /api/matches/:id/resume        -> tailored resume with provenance
GET   /api/matches/:id/resume/export?include=verified|all
```

The `include` parameter on the last route carries the most product weight in the API. **Its default is `verified`.** Unverified lines do not leave the system unless the caller explicitly asks for `all`.

The assignment's first example of a product layer response is "a validator that suppresses unverified claims." `suppresses` becomes a default parameter value.

---

## 4. High level design

### 4.1 One Worker, three entry points

```
+----------------------------------------------------------+
|  Worker                                                   |
|                                                           |
|  fetch()      Hono  --+--> /api/*   business endpoints    |
|                       +--> /*       React SPA via Assets  |
|                                                           |
|  scheduled()  hourly cron                                 |
|               SELECT users WHERE schedule_hour_utc = now  |
|               spawn one Workflow instance per user        |
|                                                           |
|  JobRunWorkflow extends WorkflowEntrypoint                |
|               the pipeline itself                         |
+----------------------------------------------------------+
          |                        |
      +---+---+              +-----+-----+
      |  D1   |              | Workers AI|
      +-------+              |  Jobicy   |
                             +-----------+
```

The cron fires hourly rather than daily. Each user stores `schedule_hour_utc` in prefs, and the hourly cron selects only the users due in the current hour. One cron expression covers every timezone instead of twenty four.

### 4.2 Workflow steps

```
step  load-inputs        read active resume and prefs. Fail fast if no resume
  |
step  fetch-postings     JobSource.fetch(), retries 3, exponential backoff
  |
step  persist-jobs       INSERT OR IGNORE, returns only newly inserted job ids
  |                      deduplication happens here, via the unique index
step  screen-inputs      pure function, no IO
  |                      description under 400 chars or boilerplate ->
  |                      matches(outcome='insufficient_input') written immediately
  |                      these postings never reach the model
  +--> step score-<jobId>     one step per posting
  |                           structured output: {score, reason, evidence[]}
  |                           retries exhausted -> outcome='score_failed'
  |                           a single failure never kills the run
  |
      gate               score >= min_score ? 'passed' : 'rejected'
  |
  +--> step tailor-<matchId>  expensive model, only for passing matches
  |    step verify-<matchId>  pure function, line by line provenance check
  |
step  finalize           write the run receipt and roll up cost
```

### 4.3 Three decisions worth defending

**One step per posting, not one step for all ten.**

This is how non-functional requirement 5 is satisfied. If the model call times out on posting 7, Workflows retries posting 7 alone, because the results for 1 through 6 are already durable. Batching all ten into one step would replay all ten calls on retry, paying twice and risking a different failure on the second pass. The n8n version had node level retry, which is coarser: the unit was the node, not the item.

**Steps pass ids and counts, never payloads.**

Workflows serializes and persists every step return value. A job description is about 5 KB, so ten of them is 50 KB moving between steps for no reason. D1 is the single state store. Steps exchange primary keys.

**`screen-inputs` runs before scoring, and it is a pure function.**

The ordering is the point. **The model never sees an input that failed screening.** This is not a prompt instructing the model to say "insufficient information," because that still relies on the model behaving. It is a deterministic gate in front of the model.

Applied to the Module 3 failure: all 35 postings with empty descriptions would have been stopped here, the run receipt would have read `insufficient_input: 35`, and the problem would have been visible on day one instead of being inferred later from suspicious looking scores.

### 4.4 Frontend

Four pages.

```
/              Dashboard    today's matches plus the run receipt banner
/matches/:id   Detail       posting, score, reason, evidence, tailored resume with highlights
/resume        Master resume editor
/settings      Search preferences and schedule
```

No realtime progress push. A manual trigger returns 202 and the client polls `/api/runs/:id` every 2 seconds, rendering stage counts. Over a three minute job, polling and a websocket are indistinguishable to the user, and polling costs one fewer Durable Object.

---

## 5. Deep dives

Each deep dive addresses one product failure mode or one non-functional requirement. The full failure mode map and tradeoffs table live in `docs/IMPACT-Living-Document.md`.

### 5.1 The pre-model input gate

Addresses: the user trusts a score computed from nothing.

`screen-inputs` is a pure function with four deterministic rules.

```
description, after HTML stripping, under 400 characters   -> insufficient_input
fewer than 40 unique tokens                               -> insufficient_input
matches a known placeholder phrase                        -> insufficient_input
title or company missing                                  -> insufficient_input
```

The 400 character floor is grounded: real Jobicy descriptions run 4000 to 7000 characters, so 400 is generous and will not produce false drops.

A second order check follows, and it is the highest value rule in the design:

```
if insufficient_input exceeds 50% of a run
  run.status = 'degraded'
  dashboard renders a banner: source quality dropped, today's results are not trustworthy
```

**This is a canary for an upstream source silently changing shape.** Under the Module 3 conditions, where 35 of 35 descriptions came back empty, this banner fires on the very first run.

### 5.2 The provenance validator

Addresses: the user sends out a resume containing something they never wrote.

There is a real choice here, and the recommended option is not the obvious one.

| Option | Tradeoff |
|---|---|
| A second model call acting as judge | Strong semantic understanding, but **it uses a model to check a model and inherits the same failure mode.** Also doubles per resume cost |
| Deterministic claim extraction (chosen) | Catches only concrete facts, misses semantic drift. But **its failure mode is uncorrelated with the model's** |

The reason for choosing the second is worth stating plainly: **a safety layer should not depend on the thing it is protecting against being correct.** A validator built out of a model fails at the same moments the model fails. A deterministic checker fails in a different way, which is the entire point of defense in depth.

```
verify(master, tailored):
  for each line in tailored:
    claims = extract(line)   # numbers, percentages, years, dates, proper nouns, tech tokens
    each claim is looked up in master with normalization
      (case, punctuation, and a small synonym map such as JS to JavaScript)
    all claims found -> verified
    otherwise        -> unverified, with the offending token recorded
```

**Stated limitation, not hidden.** This catches invented specifics, which is the dangerous class. It does not catch semantic drift that introduces no new tokens, such as rewriting "was on a team" into "led a team." That is a false negative and it is recorded in the eval plan.

In the interface, unverified lines get a yellow left border, the offending token is underlined, and a counter at the top reads "3 lines need your review." Export defaults to verified only.

### 5.3 The run receipt, and never a bare empty state

Addresses: the user reads silence as a signal.

The dashboard never renders "no matches today" on its own. It renders:

```
Run finished 8:04 AM.  20 fetched -> 6 already seen -> 3 no description -> 11 scored -> 2 passed
```

When `passed = 0`, it must say which kind of zero:

> 11 postings scored. Highest was 58. Your threshold is 70.

"Nothing qualified" and "the fetch failed" must look different on screen. This works only because `matches` keeps a row for every posting, which makes the receipt a single `GROUP BY outcome`.

### 5.4 Bounding the work, not pricing it

An earlier version of this design kept a local price table and estimated the dollar cost of every call, so a running total could be compared against a monthly ceiling. That was removed, for a reason this document has already argued once in a different context.

A local price table is a copy of someone else's billing. It goes stale without announcing it, and the number it produces is an estimate. Comparing an estimate against a ceiling and then acting on the result is exactly the pattern in failure mode 2: a confident judgment computed from an input that was never good enough to support it. The system that exists to refuse manufactured confidence should not manufacture its own.

**So spend moved to the provider.** The app runs on Cloudflare Workers AI through the `AI` binding. Cloudflare knows the real number, meters it, and refuses the call when the account is over quota. That refusal is a fact rather than an estimate, and the pipeline treats it as a first class run outcome: postings that were not scored are recorded as unscored, and the receipt says the run stopped on quota rather than on findings. This also means **the app holds no model provider secret at all**, which is why the repository can be public with nothing to strip before pushing.

What stays local is a bound on blast radius, not on money:

- **A per-run call cap.** `MAX_SCORING_CALLS_PER_RUN = 10` and `MAX_TAILORING_CALLS_PER_RUN = 4`, enforced by `callAllowed` before each call. A count is exact and needs no external fact to stay true, so a bug that loops cannot spend a month of quota in one run.
- **The score threshold is still a work reducer.** It keeps roughly 60% of postings from ever reaching the tailoring call.
- **Descriptions are truncated to 6000 characters before scoring.** Past that point additional context does not improve a fit judgment.

`usage_ledger` still records `tokens_in` and `tokens_out` per call, because the run receipt should be able to say what was called. It no longer carries `cost_usd`, because that column held a guess.

**The tradeoff, stated plainly.** The provider tells you after you have spent, not before. There is no pre-flight "this run will cost X, stop." The call cap is what replaces that, and it is a coarser instrument: it bounds the number of calls, not their size. For a personal tool making at most 14 calls a day, that bound is sufficient, and it has the advantage of being exactly true rather than approximately true.

### 5.5 The calibration loop

Addresses: by week two the user stops reading reasons, and does not notice quality drifting.

Two mechanisms.

**Agree and disagree controls on every match.** The settings page reports: "Of your last 20 reviewed decisions you disagreed with 6. Your threshold may need adjusting," and proposes a new value from the data.

**The dashboard always surfaces 2 rejected postings** beneath the accepted ones, labeled "we said no to these."

The second is deliberately counterintuitive. **A drifting scorer hides in the negative class**, because nobody inspects what was rejected. Forcing a small sample of rejections into view is the only way to notice that the model has started refusing good postings.

### 5.6 Staleness

Addresses: the user puts real effort into a role that was filled two weeks ago.

`posted_at` is captured at fetch time from the source payload. A posting older than **21 days** is labeled "may already be filled" and is excluded from the default dashboard filter, though it remains reachable and is never deleted.

21 days is chosen from the observed behavior of the source rather than from intuition. Jobicy surfaces postings well past their useful life, and a three week old remote engineering posting has usually either closed or accumulated enough applicants that a late application is not competitive. The number is a single constant with a test around it, so it is cheap to revise once there is real data.

Postings are hidden by filter rather than dropped at ingest. If the staleness rule turns out to be wrong, no data was lost while it was in effect.

---

## 6. Error handling

| Failure | Behavior |
|---|---|
| Jobicy unreachable or 5xx | Step retries 3 times with exponential backoff. On exhaustion the run is marked `failed` with the error text. The dashboard shows the failed receipt, never a blank page |
| Jobicy returns a changed shape | Response is parsed against a schema at the adapter boundary. Unparseable postings are counted and reported, not silently skipped |
| Descriptions come back empty | Not an error. Handled by `screen-inputs` and the degraded banner. This is the Module 3 failure, converted from an invisible event into a first class outcome |
| Workers AI rate limit, quota exhaustion, or timeout on scoring | Per posting step retry. On exhaustion that posting alone becomes `score_failed` and appears on the receipt. The run continues |
| Model returns malformed JSON | Structured output schema is validated. Workers AI also returns an explicit `JSON Mode couldn't be met` error when it cannot satisfy the schema. Either way it is a step failure, so it retries. On exhaustion, `score_failed` |
| Tailoring fails for one match | That match keeps its score and reason but has no resume. The detail page says so |
| No active master resume | `load-inputs` fails fast before any external call is made or any money is spent |
| Account AI quota exhausted | Cloudflare refuses the call. Postings not yet scored become `score_failed` with the refusal text, and the receipt says the run stopped on quota rather than on findings |
| A run tries to make more model calls than its cap | `callAllowed` refuses locally before the call. Remaining postings are recorded as unscored on the receipt |

The pattern throughout: **a failure produces a visible row, not an absence.**

---

## 7. Testing

Vitest with `@cloudflare/vitest-pool-workers`, which gives a real D1 through Miniflare rather than a mock.

**Unit tests, highest value first.** The three pure functions are the product layer defenses, so they get the deepest coverage:

- `screenInputs`: boundary cases at 399 and 400 characters, HTML only bodies, placeholder phrases, missing title, unicode token counting
- `verifyProvenance`: invented numbers, invented dates, invented employers, synonym handling, and an explicit test documenting the known false negative on semantic drift
- `gate`: threshold boundaries, NULL score handling
- `quota`: per-run call caps, including the prototype-key regression case

**Integration tests** run the whole Workflow with the Jobicy fetch and the AI runner stubbed, asserting the resulting receipt counts and `matches` rows.

**Regression fixtures.** Captured real Jobicy payloads, plus one degenerate payload modeled on the Module 3 LinkedIn failure where every description is null. **That incident becomes a permanent test case.** The assertion is that the run completes, produces zero scores, and is marked `degraded`.

**Contract test** on the structured output schema: a malformed model response must produce `score_failed` rather than an exception.

---

## 8. Stack

| Layer | Choice |
|---|---|
| Runtime | Cloudflare Workers |
| Orchestration | Cloudflare Workflows |
| Database | Cloudflare D1 |
| API | Hono |
| Frontend | React with Vite, served through Workers Assets |
| Scheduling | Cloudflare Cron Triggers, hourly |
| AI | Cloudflare Workers AI through the `AI` binding, JSON mode for structured output, `@cf/meta/llama-3.3-70b-instruct-fp8-fast` for both roles |
| Job source | Jobicy public API, behind a `JobSource` interface |
| Tests | Vitest with `@cloudflare/vitest-pool-workers` |

Local development is `wrangler dev`, which satisfies the assignment's "running on your laptop" requirement without needing a deployment.

---

## 9. Open items

None blocking. Two values need calibration against real data once the tool runs:

- The 400 character screening floor. Instrument it and check the drop rate against manual inspection over the first week.
- The 50% degraded threshold. Too low and normal variance triggers the banner. Too high and it misses partial source degradation.
- The 21 day staleness window. Check it against how often a posting older than that still leads anywhere.

Both are single constants with tests around them, so revising them is cheap.
