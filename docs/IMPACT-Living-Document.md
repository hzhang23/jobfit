# IMPACT Living Document

**Build:** JobFit, a job screening and resume tailoring tool
**Sections 1 and 2:** Intent and Mental Model
**Section 3:** Plumbing, the n8n build, run end to end 2026-07-31
**Sections 4 and 5:** Accuracy and Safety, Cost and Constraints, the code build on Cloudflare
**Repository:** https://github.com/hzhang23/jobfit

---

## How to read this document

It is a living document, so later sections revise earlier ones. Where that happens the earlier text is left standing and the revision is marked in a quoted block underneath it, because the reasoning that changed is more useful than a clean final answer.

Three revisions are worth finding before reading straight through.

**The cost of being wrong went from medium to high, twice.** Section 1 called it medium because a human reviews everything before it goes out. Section 2 found that the review as designed is a skim, and a skim cannot catch fabricated-but-fluent text. Section 4 found that the irreversible act is the application itself, which cannot be withdrawn. Medium in aggregate, high per incident.

**The success metric changed method.** Section 1 proposed scoring the output with a model. Section 4 rejects that shape of judge on principle, since a validator built from the thing it is protecting against fails at the same moments that thing fails, and replaces it with a blind human labeling pass plus a fabrication audit.

**There were three builds, not one.** A Lovable prototype, then the n8n pipeline in Section 3, then the code build in Sections 4 and 5. The n8n build is what taught the rest: it ran green end to end while its data source returned empty job descriptions, and would have scored every posting confidently from a job title alone. Every defense in the code build traces to that one incident.

---

## Section 1: Intent

**Problem Statement**
Mid-career tech MBAs with full-time jobs are bottlenecked in their job search because manually customizing a resume for each application is too slow to apply at volume.

**Q1. Who has this problem?**
A mid-career tech MBA who is working full-time while actively trying to break into a management role. Time is the constraint. They have the motivation to apply broadly but the manual process limits them.

**Q2. Trigger**
They find a job they want to apply to right now but don't feel ready because the resume still needs to be customized. Motivation is there; the process kills the momentum.

**Q3. Stakes**
- **Worst case:** A poorly matched resume gets filtered out by ATS or a recruiter before a human ever sees them. They're qualified but eliminated invisibly.
- **Everyday cost:** Hours spent on manual customization, capping daily applications at 1-2.
- **Fine today:** Getting 1-2 applications out per day because that's all the manual process allows.

**Q4. Cost of Being Wrong**
**Medium.** The user reviews the AI output before anything goes out, so a wrong output gets caught before it causes damage.

> **Revised in Section 2, and again in Section 4.** Section 2 downgrades two tasks from Act to Recommend after finding that the Step 6 review, as designed, is a visual skim, and a skim cannot catch fabricated-but-fluent text or a silent diff. Section 4's A4 goes further: the irreversible act is the application itself, and it cannot be withdrawn. The honest final answer is that the cost is medium in aggregate and high per incident. That distinction is what the whole build is organized around.

**Q5. Good Enough for v1**
A user goes from 1 job application per day to 10, with a resume match score above 85 (LLM-as-judge, evaluating match against ATS criteria).

> **Superseded by Section 4's A3.** Two changes.
>
> First, the measurement method. Using a model to grade the model's own output is the pattern Section 4 argues against directly: a judge built from the thing it is judging fails at the same moments that thing fails. A3 replaces it with a blind human labeling pass, where I record my own would-I-apply judgment without seeing the score, and with a fabrication audit over a 30 resume set. Slower, and uncorrelated with the model's failure mode, which is the entire point.
>
> Second, the volume number. The v1 that was actually built caps at 10 postings scored and 4 tailored resumes per run, and never submits anything. So it delivers up to 4 reviewed drafts per run, not 10 applications per day. The bottleneck it removes is the writing, not the submitting, and Section 4's A4 explains why moving the submit step was refused rather than deferred.

**Q6. Current-State Journey**

| Step | Tool | Cognitive Load | Could AI help? |
|---|---|---|---|
| 1. Read job description | Manual | Low | Low |
| 2. Evaluate job fit / check gaps | Gut check, no metrics | High | Yes |
| 3. Customize resume | LLM, fresh prompt each time | High | Yes, system prompt |
| 4. Convert to formatted resume | Python script | Medium | Yes, stable formatter |
| 5. Fix broken output | LLM, ad hoc | Medium | Yes, eliminate this step |
| 6. Human review before sending | Manual | Low | No |

**Where AI helps most:** Steps 2, 3, and 4, meaning evaluation, customization, and formatting. Step 5 should be eliminated, not automated.

---

## Section 2: Mental Model (Cognitive Task Audit)

**Early prototype:** https://job-joy-match-23.lovable.app/

**Q1. Cognitive Task Decomposition**

Starting point: current-state journey from Intent (Q6).

1. Read JD, understand role. HUMAN (flexible and low-priority, not decision-locked; can upgrade to AI-summary plus human skim as volume grows)
2. a. Judge content relevance. HUMAN
2. b. Check keyword and language alignment. AI
3. a. Decide customization strategy, meaning what to emphasize. HUMAN
3. b. Generate resume text. AI
5. a. Judge whether formatted output has problems. HUMAN (pending: if the script can auto-flag errors, this folds into Plumbing)
5. b. Generate fix patch. AI
6. Final human review before sending. HUMAN

*(Step 4, "convert to formatted resume via script," was removed from this audit. It is pure deterministic execution with no judgment, and belongs in Plumbing, not the Cognitive Task Audit.)*

**Q2. AI vs. HUMAN, with justification**

| Task | Assignment | Justification |
|---|---|---|
| 1. Read JD | HUMAN | Not decision-locked. Currently low-cost to keep manual, and not the same category as 2a, 3a, and 6, which are decision-ownership tasks |
| 2a. Judge content relevance | HUMAN | Standard lives in my own career direction and preferences; AI lacks this context |
| 2b. Check keyword alignment | AI | Text comparison against explicit criteria, JD language versus resume language, no subjective judgment involved |
| 3a. Decide customization strategy | HUMAN | This is a positioning decision, how I want to be seen by this company. I keep this decision |
| 3b. Generate resume text | AI | Once strategy is set, writing it up is execution AI does faster and more consistently |
| 5a. Judge output problems | HUMAN | Visual and formatting judgment with no fixed rule, requires my own look |
| 5b. Generate fix patch | AI | Once the problem is identified, applying the fix is mechanical execution |
| 6. Final review before sending | HUMAN | Final accountability for what goes out. This decision can't be outsourced |

**Q3 + Q4. Autonomy Ladder + Failure Cost** (combined, since Q4 revised Q3)

**2b, keyword and language alignment. Summarize.**
AI compresses the JD-versus-resume gap into a list rather than recommending what to add, because "what to emphasize" is 3a's decision, and Recommend would encroach on it.
*If wrong:* I get an inaccurate gap list, with missed or false gaps, then I make the 3a emphasis decision based on bad input, and the resume doesn't fully match the JD. Weaker competitiveness. But I re-check in 3a before acting, so this is recoverable and lower-cost.

**3b, generate resume text. Originally Act, revised to Recommend.**
Initial reasoning: strategy is already decided in 3a, so execution could go straight to final text, with Step 6 as the backstop.
*If wrong:* AI can hallucinate or exaggerate experience and project details that aren't real. Weak wording is low-cost, since Step 6 catches it on a skim. But hallucinated content is not. If Step 6 review is just a visual skim rather than fact-checking every claim, a resume with fabricated experience goes out. If questioned about it in an interview, this damages credibility and can invalidate the application. This cost is closer to high than the medium set in Intent, and a skim-based Step 6 can't reliably catch it.
*Revision:* Downgraded to Recommend. Not because "safer is better," but because the Step 6 backstop as designed, a skim, cannot structurally catch fabricated-but-fluent text. Only checking each claim against my actual experience can, and that check has to happen right after generation, by me, specifically for this. Bounded scope: I verify factual accuracy of the draft against my real experience before it moves forward.

**5b, generate fix patch. Originally Act, revised to Recommend.**
Initial reasoning: 5a already identified the problem, so applying the fix could happen without approval, with 5a and Step 6 as backstops.
*If wrong:* AI patches the flagged issue but silently alters something else, deleting a line or changing a number or date, and 5a's check is scoped to "does formatting look right," not "was anything else silently changed." This is the most hidden and potentially highest-cost failure of the three. If Step 6 is also just a visual skim, a silently altered resume with wrong dates or missing content goes out with me unaware it happened, until it surfaces later. This cost is closer to high than medium, and existing backstops aren't designed to catch it.
*Revision:* Downgraded to Recommend. A skim-based downstream review can't catch a diff-shaped error; you can only catch it by looking at the diff itself. Bounded scope: I review a diff of what changed, not a full re-read of the resume, which keeps review cost proportional to the size of the change rather than the length of the document.

> **What Section 4 did with this.** The 3b revision is the direct ancestor of the provenance validator. Section 2 concluded that a skim cannot catch fabricated-but-fluent text and that only checking each claim against real experience can. Section 4's A2 turns that conclusion into a mechanism: a deterministic pass that extracts every concrete claim from the generated resume and checks it against the master, so the check no longer depends on my attention holding up on the fortieth draft.
>
> The 5b revision, review the diff rather than the document, did not survive into the build. The formatter and the fix-patch step were both cut, and the tool emits plain text, so there is no patch to diff. The reasoning still stands for the day formatting comes back.

**Q5. One-Line Mental Model**

AI does information comparison and content generation, meaning anything with a clear input, a reusable standard, and a verifiable result. The human keeps every judgment about relevance, what to emphasize, whether it's true, and whether it's ready to send, and confirms AI output before it's finalized, not after.


---

## Section 3: Plumbing

**IMPACT Living Document**
**Module 3 build:** AI Job Screening & Resume Tailoring Pipeline (n8n)
**Status:** Built and run end to end, 2026-07-31

---

### Part A: Find the Task to Automate

#### A1. SCAN your repetitive work

| Task | Time per week | Repeatability |
|---|---|---|
| Screen new job postings to decide if a role is worth applying to | 2.5 hrs | High |
| Rewrite my resume against a specific job description | 3 hrs | High |
| Log what I applied to and keep the status current | 0.5 hr | High |
| Compile a weekly written progress update | 0.5 hr | High |
| Turn case readings and PDFs into structured notes | 2 hrs | Medium |
| Draft networking and follow-up messages | 1 hr | Medium |
| Reformat data pulls into slide-ready tables | 1.5 hrs | Low |

#### A2. MARK the friction

| Task | dread | copy-paste | read-sort | hand-off | Flags |
|---|:---:|:---:|:---:|:---:|:---:|
| Screen new job postings | ✓ | | ✓ | ✓ | **3** |
| Rewrite resume against a JD | ✓ | ✓ | | ✓ | **3** |
| Log applications and status | ✓ | ✓ | | ✓ | **3** |
| Weekly progress update | | ✓ | ✓ | | 2 |
| Case readings into notes | | | ✓ | ✓ | 2 |
| Networking messages | ✓ | | | | 1 |
| Reformat data into tables | | ✓ | | | 1 |

The top three all carry the same three flags, and they are the same three because **they are consecutive steps of one job.** Screening produces the input for tailoring, and tailoring produces the thing that gets logged. The friction is not three separate problems. It is one pipeline I run by hand.

#### A3. TOP 3 candidates

| Candidate | Input (from where) | Output (to where) |
|---|---|---|
| 1. Screen new job postings for fit | Job boards (LinkedIn, or a job API) | A ranked shortlist with a reason per role |
| 2. Rewrite resume against a JD | My master resume + one job description | One tailored resume document per role |
| 3. Turn case readings into notes | PDFs in a Google Drive folder | A structured notes document |

#### A4. n8n REACHABILITY check

| Candidate | Input side | Output side | Verdict |
|---|---|---|---|
| 1. Screen postings | **LinkedIn: scraping only.** No native n8n integration, no public jobs API | Google Sheets, native node | **Cross out as originally scoped.** Feasible only if the input is swapped for a public job API reachable by the HTTP node |
| 2. Rewrite resume | Google Docs, native node | Google Docs, native node | Reachable |
| 3. Readings into notes | Google Drive, native node | Google Docs, native node | Reachable |

**I broke this rule and it cost me the build.**

A4 says plainly: if either side needs scraping, cross the candidate out, because picking it turns a build lab into a project. I picked LinkedIn anyway and routed it through a third-party scraping platform, which felt like a legitimate workaround.

It was not. Two attempts failed for two unrelated reasons. The first scraper turned out to be a $29.99/month rental. The second returned **`description: null` on 35 of 35 job postings**, every one carrying `"Blocked on job detail (captcha/access denied)"`. LinkedIn serves titles from the search page and captchas every detail page.

That second failure is the dangerous kind. It does not raise an error. Every node would have gone green, the AI would have scored every job confidently from a job title alone, and the tracker would have filled with noise that looked exactly like signal.

The fix was the thing A4 told me to do at the start: use a source with a real public API. The pipeline now calls the **Jobicy** public jobs API. Free, no authentication, full 4000 to 7000 character descriptions.

#### A5. PICK ONE

**My Module 3 build task: screen new job postings against my resume, and produce a tailored resume for the ones that score well.**

This is candidates 1 and 2 chained, which is slightly larger than the smallest viable v1. I chained them deliberately. They share the same input, and candidate 2 on its own has no value: tailoring a resume is only worth doing for a role that already passed screening. Splitting them would have produced a v1 that hands me a list and then makes me do the tedious half by hand.

Candidate 3 was dropped. Both ends are reachable and it would have built cleanly, but it does not carry the dread flag. It is tedious, not avoided.

---

### Part B: Design It

#### B1. AI INTEGRATION LEVEL

**Level 3: AI is a core feature with its own UX and data layer.**

Remove the AI and nothing is left but an RSS reader, because the scoring decision and the tailored resume are the entire product; the tracker sheet is the data layer and the interface I actually read each morning.

**Why not Level 2:** Level 2 bolts AI onto a workflow that already works. There is no underlying workflow here. Fetching job listings without judging them is not a thing I would run.

**Why not Level 4:** Level 4 is agent-led, where the AI chooses its own tools and takes action. Every route on my canvas is hard-wired. The AI is called at two fixed points to do two predetermined jobs and never decides what happens next.

#### B2. ARCHITECTURE in one paragraph

Every morning a schedule trigger reads my master resume out of a Google Doc and pulls twenty fresh job postings from the Jobicy public API. The postings are capped at ten, their field names are normalized, HTML is stripped out of the descriptions, and anything already processed in an earlier run is dropped. Each remaining posting goes to **GPT-4o-mini, which acts as a judge**: it returns a fit score from 0 to 100 plus one sentence explaining the score, and that score feeds an If node that discards anything below 70. Only what survives reaches **GPT-4o, which acts as a writer**: it rewrites my master resume against that specific job description, under a prompt that forbids inventing any experience, date, or metric. Each rewrite is saved as a new Google Doc in a dedicated Drive folder, and one row per match is appended to a Google Sheet holding the company, title, score, the AI's stated reason, and a link to the resume. Nothing is stored inside the workflow except the list of job URLs already seen; the resume, the documents, and the tracker all live in Google Drive, so I can edit my resume without ever touching the pipeline.

#### B3. THE "RIGHT TOOL" CHECK

| Alternative considered | Why I rejected it |
|---|---|
| **Buy an off-the-shelf tool** (Teal, Jobscan, Simplify) | They score against their own opaque criteria, not mine, and they cannot write into the Google Docs and Sheets stack I already live in. The deeper problem is auditability: I need a stated reason per job so I can check whether the model's judgment is any good. A black-box match percentage cannot be spot-checked, so I would end up re-reading every posting myself, which is the exact work I am trying to remove. |
| **Build it as a Level 4 agent** (n8n AI Agent node with tools) | An agent earns its complexity when the path is unknown in advance. My path is identical on every run: fetch, score, gate, write, save, log. An agent would add unpredictability, latency, and cost while buying nothing. It would also make failures much harder to locate, because the sequence would differ run to run. |
| **Keep doing it manually with ChatGPT** (paste each JD in by hand) | This is the honest baseline, and it is what I was already doing. It produces good output but scales linearly with my attention, which is the scarce resource. It also fails silently in a different way: by the eighth posting I am tired and my screening standard drifts. The machine applies the same criteria to posting 100 as to posting 1. |

#### B4. HUMAN-IN-THE-LOOP placements

| Where the system pauses for me | What I am doing there | Why it cannot be automated |
|---|---|---|
| **Setting the 70 threshold** | Calibration | The number encodes my tolerance for wasted applications. It is a preference, not a fact, so no model can derive it |
| **Reading the `reason` column** | Auditing the judge | This is why the tracker stores the reason and not just the score. A reason can be spot-checked. A bare number cannot |
| **Reviewing the tailored resume** | Fabrication check | The prompt forbids inventing experience, but a prompt constraint is a mitigation, not a guarantee. A fabricated line on a resume can cost an offer |
| **Clicking submit** | The final gate | Deliberately never automated. **Irreversible, outward-facing actions stay with the human** |
| **Editing the master resume** | Owning the source of truth | The AI may only reorder and rephrase what I wrote. It never authors the underlying claims |

The system produces a shortlist and a set of drafts. **It never sends anything.**

> **What changed in the code build.** Sections 4 and 5 rebuilt this pipeline as a web app, and three things in the spec above did not survive.
>
> The models changed. GPT-4o-mini and GPT-4o were replaced by Cloudflare Workers AI running an open weights model for both roles. Section 5's fourth tradeoff explains why: it removed the last provider secret from the project and moved spend metering to the provider, at the cost of a weaker model.
>
> Google Docs and Sheets are gone. The app owns its own storage, so there is no per-user OAuth and no sync to keep honest. Section 5's cut list covers it.
>
> The schedule is hourly, not daily at 8:00. Each user stores the hour they want and the hourly cron picks only the users due, so one expression covers every timezone.
>
> What did survive, unchanged, is the shape: fetch, screen, score with a stated reason, gate, write, and never send.

#### B5. THE FIVE-LINE SPEC

**Trigger:** Daily 8:00 AM schedule, plus a manual trigger for testing.

**Step 1:** Read the master resume from Google Docs and pull 20 fresh postings from the Jobicy API.

**Step 2:** Cap to 10, normalize field names, strip HTML from descriptions, drop anything seen in a previous run.

**Step 3:** GPT-4o-mini scores each posting 0-100 with a one-line reason; only scores of 70 or above continue; GPT-4o then rewrites the resume against those job descriptions.

**Output:** One tailored resume per match in a Google Docs folder, plus one tracker row per match in Google Sheets carrying company, title, score, the AI's reason, and the resume link.

---

### Appendix: What Happened When I Built It

#### The run

2026-07-31. Every node green, end to end.

| Stage | Items |
|---|---|
| Fetched from Jobicy | 20 |
| Kept after Limit | 10 |
| Passed dedupe | 10 |
| Scored by GPT-4o-mini | 10 |
| **Cleared the 70 gate** | **4** |
| Rejected | 6 |
| Tailored resumes written | 4 |
| Tracker rows appended | 4 |

A 40% pass rate is a useful signal. The gate is neither rejecting everything nor waving everything through, which is what a badly-set threshold looks like from the outside. 70 stays for now.

#### What broke, in order

| What broke | Symptom | What I learned |
|---|---|---|
| First Apify actor | $29.99/month rental, not covered by the free tier | Check the pricing model before the input schema |
| Second Apify actor | `description: null` on 35 of 35 postings, captcha on every detail page | **A4's scraping rule is not bureaucratic caution. It is load-bearing** |
| My Google Docs parsing code | Found nothing in the document | The n8n node already flattens the doc into a `content` string. I wrote a parser for a shape the node never returns |
| Cross-execution dedupe | Re-running the same search returned **0 items**, and every downstream node reported "not executed" | The node was correct. I was the one repeating myself. Fixed with an unconnected `Clear Deduplication History` node parked beside the pipeline, which never fires on a normal run |
| Google Docs create node | Refused to run | `folderId` is required, not optional |
| Google Sheets append | Refused to run | `defineBelow` mapping needs a `columns.schema`, which n8n normally fills by reading the header row |

#### The one thing worth keeping

**The most dangerous failure in this build never raised an error.**

When LinkedIn blocked every job description, the pipeline stayed structurally healthy. GPT-4o-mini would have returned a confident, well-formatted score for every posting, computed from a job title and nothing else. Every node green. Tracker full. Every row worthless.

That is why the human-in-the-loop placements in B4 are concentrated on **reading the AI's reasoning**, not on watching for errors. Errors announce themselves. Confident nonsense does not.

#### What the swap actually cost

Replacing the data source touched **one node, plus one added Split Out node.** The scoring prompt, the gate, the resume writer, both Google Docs nodes, and the Sheets node were untouched.

Isolating the least reliable external dependency at the very first node was the single decision that paid for itself.

#### What I gave up

Jobicy is remote-only and filters by country, not city. I live in Seattle and can no longer target local roles.

I took that trade knowingly. **Without job descriptions, the entire AI half of this pipeline is decorative.** Descriptions mattered more than geography.

---

## Section 4: Accuracy and Safety

### A1. Top 5 failure modes

These are product failure modes, stated as what the user experiences.

| # | Failure mode (what the user experiences) |
|---|---|
| 1 | I sent out a resume containing an accomplishment I never wrote, because the rewriting model embellished it |
| 2 | I trusted a score of 92 and applied to a role that was a poor fit, because that posting's description was empty and the model scored it from the title |
| 3 | I saw an empty dashboard and concluded there was nothing good today, when in fact the fetch had silently failed |
| 4 | I put real effort into applying to a role that was filled two weeks ago |
| 5 | By week two I stopped reading the reasons and applied to anything above 70. The tool trained me into clicking without looking, my application quality dropped, and I did not notice |

### A2. Product-layer response to each failure

| Failure mode | Product-layer response |
|---|---|
| **1. Fabricated content reaches a real employer** | A deterministic provenance validator runs over every generated resume. Each line's concrete claims (numbers, dates, employers, technologies) are checked against the master resume. Unflagged lines render normally; unverified lines render with a warning marker and the offending token underlined. **The export endpoint defaults to `include=verified`, so unverified lines do not leave the system unless the user explicitly asks for the full text.** |
| **2. A confident score computed from nothing** | A deterministic screening gate runs **before** the model, not after it. Postings whose description is under 400 characters, is boilerplate, or is missing entirely are recorded as `insufficient_input` and **never reach the model at all**. Their score is stored as `NULL`, not `0`, because zero is a judgment and NULL is the absence of one. If more than 50% of a run is screened out this way, the whole run is marked `degraded` and the dashboard shows a banner saying the source quality dropped and today's results are not trustworthy. |
| **3. Silence read as a signal** | Every posting that enters a run leaves a row in the database with its outcome and the reason for it, including the ones that were dropped. The dashboard therefore never renders a bare "no matches today." It renders a run receipt: `20 fetched, 6 already seen, 3 no description, 11 scored, 2 passed`. When zero postings pass, it states which kind of zero: "11 postings scored, highest was 58, your threshold is 70." |
| **4. Stale postings** | Posting date is captured at fetch time and displayed. Anything older than 21 days is labeled "may already be filled" and drops out of the default dashboard view. It is hidden by a filter rather than deleted, so if the rule turns out to be wrong no data was lost while it was in effect. |
| **5. Automation bias** | A calibration loop. Each match carries an agree/disagree control, and the settings page reports the disagreement rate: "of your last 20 reviewed decisions you disagreed with 6, your threshold may need adjusting." Separately, **the dashboard always surfaces 2 rejected postings beneath the accepted ones**, labeled "we said no to these." A drifting scorer hides in the negative class because nobody inspects what was rejected, so a sample of rejections is forced into view. |

**Four of these five are implemented in the v1 build**, verified against the running app: the pre-model screening gate, the provenance validator, the run receipt, and the calibration loop. The calibration loop ships complete, meaning the per match agree and disagree control, the disagreement rate on the settings page, and the two rejected postings forced onto the dashboard under the heading "we said no to these".

**Response 4, the staleness window, is the one that did not land.** Posting date is captured at fetch time and carried all the way to the interface, so the data is there, but nothing yet labels a posting older than 21 days or filters it out of the default view. It is the cheapest of the five to add and the least dangerous to omit, which is exactly why it lost. Naming it here rather than quietly implying five of five is the point of the exercise.

#### A note on response 1

There was a real choice in how to build the provenance validator, and the obvious option was rejected.

The obvious option is a second model call acting as a judge, asking whether each line follows from the master resume. It understands language better. It was cut anyway, because **a safety layer should not depend on the thing it is protecting against being correct.** A validator built out of a model fails at the same moments the model fails, so it adds cost without adding independence. Deterministic claim extraction is weaker at language and stronger at exactly the thing that matters: its failure mode is uncorrelated with the model's.

The cost of that choice is stated honestly rather than hidden. Deterministic extraction catches invented specifics, which is the dangerous class. It does not catch semantic drift that introduces no new tokens, such as rewriting "was on a team" into "led a team." That false negative is a known gap, has a dedicated test documenting it, and is accounted for in the eval plan below.

### A3. Eval plan

**Primary metric: fabrication.**

> I will measure **the fabrication rate of tailored resumes** using **a 30 resume audit set, reading every generated line against the master resume and labeling any line that contains a claim I did not write**. The target is **zero fabricated lines that the validator failed to flag**. The minimum bar is **validator recall of 1.0 on that audit set, accepting a false positive rate up to 20%**.

The asymmetry between those two error types is deliberate. A false positive costs me five seconds of reading. A false negative can cost an interview and attaches a credibility problem to my real name. So the validator is tuned to over-flag, and the bar is set on recall rather than on accuracy.

**Secondary metric: gate precision.**

> I will measure **the precision of the 70 point gate** using **a blind labeling pass over 50 gated matches, where I record my own would-I-apply judgment without seeing the score**. The target is **0.80**. The minimum bar is **0.60**.

Below 0.60 the gate is not outperforming my own skim of the job titles, which means the feature is not earning its cost and should be cut rather than tuned.

### A4. The uncomfortable question

On Tuesday afternoon the job API changes its response shape and descriptions start coming back as empty strings. I find out on Friday.

In between, the tool ran three times and produced twelve confident matches, every one scored on a job title alone. I applied to six of them, using resumes tailored against nothing. Six companies now hold a resume from me that seriously misrepresents my fit, and two of them are companies I actually wanted. **You get one first application. It cannot be withdrawn.**

Nobody is physically harmed and there is no headline, so the autonomy level does not need to drop further. But this scenario is the reason for two specific design decisions. The submit action is never automated, so the irreversible step always requires a human. And the screening gate sits **in front of** the model rather than behind it, so an empty description is caught before any judgment is manufactured from it. The degraded-run banner exists for exactly one purpose: to turn this from a Friday discovery into a Tuesday one.

---

## Section 5: Cost and Constraints

### C1. Top 3 tradeoffs

**1. Coverage vs. accuracy. Decision: accuracy.**
Postings without a substantial description are dropped before scoring, rather than scored with a disclaimer attached. The expected loss is 15% to 30% of everything fetched. I would rather be shown 4 matches I can defend than 10 I cannot.

**2. Latency vs. verification depth. Decision: verification depth.**
Every generated resume now goes through an additional provenance pass, and the run got slower. The run is asynchronous and nobody is waiting on it. **Latency was the cheapest currency I had, so it is the one I spent.**

**3. Autonomy vs. trust. Decision: trust.**
The ceiling is drafts. The tool never sends, never applies, never emails. Lowering autonomy is the only thing that makes the A4 scenario survivable rather than unrecoverable.

#### A fourth tradeoff, decided after the first three

**Model strength vs. not having to be right about cost. Decision: give up the stronger model.**

The build originally called a frontier model with an API key, and carried a local price table so it could estimate the dollars each run spent and stop itself at a monthly ceiling. A code review found that the price lookup returned `NaN` for certain inputs, and that `NaN` compares false against any threshold, so the ceiling never tripped. The circuit breaker had never worked.

The interesting part is not the bug. It is that **I had built the exact thing this document is about.** A local price table is a copy of someone else's billing that goes stale without telling you, and I was computing a confident number from it and acting on that number. That is failure mode 2 with the inputs changed: a judgment manufactured from an input that was never good enough to support it.

So the estimator was deleted rather than fixed, and the app moved to Cloudflare Workers AI. Spend is now metered and refused by the provider, which knows the real number. What is enforced locally is a hard cap on how many model calls one run may make, which is exact and depends on no external fact.

**What I gave up:** an open weights model in the Llama 3.3 70B class instead of a frontier model. Scoring quality is measurably lower, and the eval bar in A3 is what will tell me whether it is low enough to matter.

**What I got:** the app holds no model provider secret at all, so the repository is public with nothing to strip before pushing. And the thing that decides whether to keep spending is now a fact rather than an estimate I maintain by hand.

**The cost I am still paying:** the provider tells you after you have spent, not before. There is no pre-flight cost check anymore. The call cap replaces it, and it is coarser, since it bounds the number of calls rather than their size. For a tool making at most 14 calls a day I will take that.

### C2. Latency budget

| Surface | Budget | Why |
|---|---|---|
| Dashboard first paint | 500 ms | This is the morning glance. Any slower and I stop opening it, and an unopened tool has zero value |
| "Run now" acknowledgement | 300 ms | The click must register immediately. The actual work is asynchronous, so only the acknowledgement is on the critical path |
| Run status poll | 200 ms | Polled every 2 seconds while a run is active, so it has to be cheap |
| Full run over 10 postings | 4 min | Nobody is watching. The scheduled run finishes before I wake up |
| Match detail and tailored resume | 1 s | This is reading, served from the database |
| **Provenance highlights** | **Must paint in the same frame as the resume text** | If the markers arrive after the text, I read the unmarked version first and the validator has failed at its job. **This is a correctness requirement wearing a latency budget's clothing** |

### C3. The 70/30 split

**70% validated:** Cloudflare Workers, D1, Hono, React with Vite, hand written SQL, Workers AI JSON mode for structured output, and the Jobicy public REST API. All boring, all documented, all things I can search for an answer about when they break.

**30% experimental:** Cloudflare Workflows as the durable orchestrator, which is generally available but young and has a small community, and the provenance validator, which is my own heuristic with no established precision.

The reason 30% is acceptable here is that **both experimental pieces are contained**. If Workflows misbehaves, the run does not finish and it retries tomorrow. If the validator misbehaves, it over-flags and costs me a few extra seconds of reading. Neither one degrades into a wrong output reaching an employer, which is the only failure I actually care about.

### C4. The cut list

| Cut | Why I cut it |
|---|---|
| **Multi-user accounts, invite codes, and per-user quotas** | This is infrastructure, not product. Not one of my five failure modes involves authentication, so building it would have bought zero safety. The schema still carries `user_id` on every table and the code reads through a `getCurrentUser()` seam, so adding it later is additive and needs no migration. **The time this freed went directly into the provenance validator**, which does address a failure mode |
| **Auto-apply and auto-send** | A4 established that the irreversible action is the application itself. Automating it converts a three day gap between failure and discovery from embarrassing into unrecoverable. Deliberately not built, and deliberately no seam left for it either, because a seam is an invitation |
| **A local cost estimator and a dollar ceiling** | It computed a confident number from a hand maintained price table and then gated real behaviour on that number, which is the same shape as the failure the whole build exists to prevent. Deleted rather than repaired. The provider meters spend now, and what stays local is an exact cap on calls per run |
| **Using a model as the provenance judge** | A validator built from a model inherits the model's failure mode, so it adds cost without adding independence. Deterministic extraction fails in an uncorrelated way, which is the entire purpose of a defense layer. It also halves the per resume cost |

Also cut: realtime websocket progress, because 2 second polling is indistinguishable to a user over a 3 minute job and it saves a Durable Object. And Google Docs and Sheets sync, because per-user OAuth would have consumed roughly half the project for zero movement on any failure mode.
