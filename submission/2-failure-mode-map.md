> Section 4 of the IMPACT Living Document, submitted separately because the
> assignment asks for it separately. The full document, including how the
> reasoning here revised Sections 1 and 2, is at
> [docs/IMPACT-Living-Document.md](../docs/IMPACT-Living-Document.md).
>
> Generated from that document by `npm run build:submission`. Edit the living
> document, not this file.

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
