# JobFit

Fetches job postings on a schedule, scores each one against your resume with a stated reason, writes a tailored resume for the ones that clear your threshold, and shows you the shortlist.

**Status: design complete, implementation not started.**

## Documents

| Document | What it is |
|---|---|
| [Design spec](docs/superpowers/specs/2026-08-12-jobfit-design.md) | Requirements, data model, API, architecture, deep dives, error handling, testing |
| [Sections 4 and 5](docs/IMPACT-Sections-4-5.md) | Failure Mode Map and Tradeoffs Table |

## The one-line reason this exists

The predecessor to this tool was an n8n workflow. It ran green end to end while the upstream source returned empty job descriptions, and the AI scored every posting confidently from a job title alone. Every design decision here follows from that: the interesting problem is not scale, it is knowing when the system does not actually know.
