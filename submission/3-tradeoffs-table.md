> Section 5 of the IMPACT Living Document, submitted separately because the
> assignment asks for it separately. The full document, including how the
> reasoning here revised Sections 1 and 2, is at
> [docs/IMPACT-Living-Document.md](../docs/IMPACT-Living-Document.md).
>
> Generated from that document by `npm run build:submission`. Edit the living
> document, not this file.

# Section 5: Cost and Constraints

## C1. Top 3 tradeoffs

**1. Coverage vs. accuracy. Decision: accuracy.**
Postings without a substantial description are dropped before scoring, rather than scored with a disclaimer attached. The expected loss is 15% to 30% of everything fetched. I would rather be shown 4 matches I can defend than 10 I cannot.

**2. Latency vs. verification depth. Decision: verification depth.**
Every generated resume now goes through an additional provenance pass, and the run got slower. The run is asynchronous and nobody is waiting on it. **Latency was the cheapest currency I had, so it is the one I spent.**

**3. Autonomy vs. trust. Decision: trust.**
The ceiling is drafts. The tool never sends, never applies, never emails. Lowering autonomy is the only thing that makes the A4 scenario survivable rather than unrecoverable.

### A fourth tradeoff, decided after the first three

**Model strength vs. not having to be right about cost. Decision: give up the stronger model.**

The build originally called a frontier model with an API key, and carried a local price table so it could estimate the dollars each run spent and stop itself at a monthly ceiling. A code review found that the price lookup returned `NaN` for certain inputs, and that `NaN` compares false against any threshold, so the ceiling never tripped. The circuit breaker had never worked.

The interesting part is not the bug. It is that **I had built the exact thing this document is about.** A local price table is a copy of someone else's billing that goes stale without telling you, and I was computing a confident number from it and acting on that number. That is failure mode 2 with the inputs changed: a judgment manufactured from an input that was never good enough to support it.

So the estimator was deleted rather than fixed, and the app moved to Cloudflare Workers AI. Spend is now metered and refused by the provider, which knows the real number. What is enforced locally is a hard cap on how many model calls one run may make, which is exact and depends on no external fact.

**What I gave up:** an open weights model in the Llama 3.3 70B class instead of a frontier model. Scoring quality is measurably lower, and the eval bar in A3 is what will tell me whether it is low enough to matter.

**What I got:** the app holds no model provider secret at all, so the repository is public with nothing to strip before pushing. And the thing that decides whether to keep spending is now a fact rather than an estimate I maintain by hand.

**The cost I am still paying:** the provider tells you after you have spent, not before. There is no pre-flight cost check anymore. The call cap replaces it, and it is coarser, since it bounds the number of calls rather than their size. For a tool making at most 14 calls a day I will take that.

## C2. Latency budget

| Surface | Budget | Why |
|---|---|---|
| Dashboard first paint | 500 ms | This is the morning glance. Any slower and I stop opening it, and an unopened tool has zero value |
| "Run now" acknowledgement | 300 ms | The click must register immediately. The actual work is asynchronous, so only the acknowledgement is on the critical path |
| Run status poll | 200 ms | Polled every 2 seconds while a run is active, so it has to be cheap |
| Full run over 10 postings | 4 min | Nobody is watching. The scheduled run finishes before I wake up |
| Match detail and tailored resume | 1 s | This is reading, served from the database |
| **Provenance highlights** | **Must paint in the same frame as the resume text** | If the markers arrive after the text, I read the unmarked version first and the validator has failed at its job. **This is a correctness requirement wearing a latency budget's clothing** |

## C3. The 70/30 split

**70% validated:** Cloudflare Workers, D1, Hono, React with Vite, hand written SQL, Workers AI JSON mode for structured output, and the Jobicy public REST API. All boring, all documented, all things I can search for an answer about when they break.

**30% experimental:** Cloudflare Workflows as the durable orchestrator, which is generally available but young and has a small community, and the provenance validator, which is my own heuristic with no established precision.

The reason 30% is acceptable here is that **both experimental pieces are contained**. If Workflows misbehaves, the run does not finish and it retries tomorrow. If the validator misbehaves, it over-flags and costs me a few extra seconds of reading. Neither one degrades into a wrong output reaching an employer, which is the only failure I actually care about.

## C4. The cut list

| Cut | Why I cut it |
|---|---|
| **Multi-user accounts, invite codes, and per-user quotas** | This is infrastructure, not product. Not one of my five failure modes involves authentication, so building it would have bought zero safety. The schema still carries `user_id` on every table and the code reads through a `getCurrentUser()` seam, so adding it later is additive and needs no migration. **The time this freed went directly into the provenance validator**, which does address a failure mode |
| **Auto-apply and auto-send** | A4 established that the irreversible action is the application itself. Automating it converts a three day gap between failure and discovery from embarrassing into unrecoverable. Deliberately not built, and deliberately no seam left for it either, because a seam is an invitation |
| **A local cost estimator and a dollar ceiling** | It computed a confident number from a hand maintained price table and then gated real behaviour on that number, which is the same shape as the failure the whole build exists to prevent. Deleted rather than repaired. The provider meters spend now, and what stays local is an exact cap on calls per run |
| **Using a model as the provenance judge** | A validator built from a model inherits the model's failure mode, so it adds cost without adding independence. Deterministic extraction fails in an uncorrelated way, which is the entire purpose of a defense layer. It also halves the per resume cost |

Also cut: realtime websocket progress, because 2 second polling is indistinguishable to a user over a 3 minute job and it saves a Durable Object. And Google Docs and Sheets sync, because per-user OAuth would have consumed roughly half the project for zero movement on any failure mode.
