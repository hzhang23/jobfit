# Sections 4 and 5: Accuracy and Cost

**IMPACT Living Document**
**Module 4 build:** JobFit, a job screening and resume tailoring web app on Cloudflare
**Date:** 2026-08-12

Context carried forward from Section 3. The Module 3 build was the same pipeline in n8n. It ran successfully on 2026-07-31. Before that success it failed once in a way that shapes everything below: an upstream source returned empty job descriptions, every node stayed green, and the AI produced confident scores computed from job titles alone. Nothing raised an error. That incident is the origin of most of this document.

---

# Section 4: Accuracy and Safety

## A1. Top 5 failure modes

These are product failure modes, stated as what the user experiences.

| # | Failure mode (what the user experiences) |
|---|---|
| 1 | I sent out a resume containing an accomplishment I never wrote, because the rewriting model embellished it |
| 2 | I trusted a score of 92 and applied to a role that was a poor fit, because that posting's description was empty and the model scored it from the title |
| 3 | I saw an empty dashboard and concluded there was nothing good today, when in fact the fetch had silently failed |
| 4 | I put real effort into applying to a role that was filled two weeks ago |
| 5 | By week two I stopped reading the reasons and applied to anything above 70. The tool trained me into clicking without looking, my application quality dropped, and I did not notice |

## A2. Product-layer response to each failure

| Failure mode | Product-layer response |
|---|---|
| **1. Fabricated content reaches a real employer** | A deterministic provenance validator runs over every generated resume. Each line's concrete claims (numbers, dates, employers, technologies) are checked against the master resume. Unflagged lines render normally; unverified lines render with a warning marker and the offending token underlined. **The export endpoint defaults to `include=verified`, so unverified lines do not leave the system unless the user explicitly asks for the full text.** |
| **2. A confident score computed from nothing** | A deterministic screening gate runs **before** the model, not after it. Postings whose description is under 400 characters, is boilerplate, or is missing entirely are recorded as `insufficient_input` and **never reach the model at all**. Their score is stored as `NULL`, not `0`, because zero is a judgment and NULL is the absence of one. If more than 50% of a run is screened out this way, the whole run is marked `degraded` and the dashboard shows a banner saying the source quality dropped and today's results are not trustworthy. |
| **3. Silence read as a signal** | Every posting that enters a run leaves a row in the database with its outcome and the reason for it, including the ones that were dropped. The dashboard therefore never renders a bare "no matches today." It renders a run receipt: `20 fetched, 6 already seen, 3 no description, 11 scored, 2 passed`. When zero postings pass, it states which kind of zero: "11 postings scored, highest was 58, your threshold is 70." |
| **4. Stale postings** | Posting date is captured at fetch time and displayed. Anything older than 21 days is labeled "may already be filled" and drops out of the default dashboard view. It is hidden by a filter rather than deleted, so if the rule turns out to be wrong no data was lost while it was in effect. |
| **5. Automation bias** | A calibration loop. Each match carries an agree/disagree control, and the settings page reports the disagreement rate: "of your last 20 reviewed decisions you disagreed with 6, your threshold may need adjusting." Separately, **the dashboard always surfaces 2 rejected postings beneath the accepted ones**, labeled "we said no to these." A drifting scorer hides in the negative class because nobody inspects what was rejected, so a sample of rejections is forced into view. |

**Four of these five are implemented in the v1 build**, verified against the running app: the pre-model screening gate, the provenance validator, the run receipt, and the calibration loop. The calibration loop ships complete, meaning the per match agree and disagree control, the disagreement rate on the settings page, and the two rejected postings forced onto the dashboard under the heading "we said no to these".

**Response 4, the staleness window, is the one that did not land.** Posting date is captured at fetch time and carried all the way to the interface, so the data is there, but nothing yet labels a posting older than 21 days or filters it out of the default view. It is the cheapest of the five to add and the least dangerous to omit, which is exactly why it lost. Naming it here rather than quietly implying five of five is the point of the exercise.

### A note on response 1

There was a real choice in how to build the provenance validator, and the obvious option was rejected.

The obvious option is a second model call acting as a judge, asking whether each line follows from the master resume. It understands language better. It was cut anyway, because **a safety layer should not depend on the thing it is protecting against being correct.** A validator built out of a model fails at the same moments the model fails, so it adds cost without adding independence. Deterministic claim extraction is weaker at language and stronger at exactly the thing that matters: its failure mode is uncorrelated with the model's.

The cost of that choice is stated honestly rather than hidden. Deterministic extraction catches invented specifics, which is the dangerous class. It does not catch semantic drift that introduces no new tokens, such as rewriting "was on a team" into "led a team." That false negative is a known gap, has a dedicated test documenting it, and is accounted for in the eval plan below.

## A3. Eval plan

**Primary metric: fabrication.**

> I will measure **the fabrication rate of tailored resumes** using **a 30 resume audit set, reading every generated line against the master resume and labeling any line that contains a claim I did not write**. The target is **zero fabricated lines that the validator failed to flag**. The minimum bar is **validator recall of 1.0 on that audit set, accepting a false positive rate up to 20%**.

The asymmetry between those two error types is deliberate. A false positive costs me five seconds of reading. A false negative can cost an interview and attaches a credibility problem to my real name. So the validator is tuned to over-flag, and the bar is set on recall rather than on accuracy.

**Secondary metric: gate precision.**

> I will measure **the precision of the 70 point gate** using **a blind labeling pass over 50 gated matches, where I record my own would-I-apply judgment without seeing the score**. The target is **0.80**. The minimum bar is **0.60**.

Below 0.60 the gate is not outperforming my own skim of the job titles, which means the feature is not earning its cost and should be cut rather than tuned.

## A4. The uncomfortable question

On Tuesday afternoon the job API changes its response shape and descriptions start coming back as empty strings. I find out on Friday.

In between, the tool ran three times and produced twelve confident matches, every one scored on a job title alone. I applied to six of them, using resumes tailored against nothing. Six companies now hold a resume from me that seriously misrepresents my fit, and two of them are companies I actually wanted. **You get one first application. It cannot be withdrawn.**

Nobody is physically harmed and there is no headline, so the autonomy level does not need to drop further. But this scenario is the reason for two specific design decisions. The submit action is never automated, so the irreversible step always requires a human. And the screening gate sits **in front of** the model rather than behind it, so an empty description is caught before any judgment is manufactured from it. The degraded-run banner exists for exactly one purpose: to turn this from a Friday discovery into a Tuesday one.

---

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
