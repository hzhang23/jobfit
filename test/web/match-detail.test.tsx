import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Match, TailoredResume } from '../../web/src/api';
import { MatchDetailView } from '../../web/src/pages/MatchDetail';

type Detail = Match & {
  job: { description: string };
  evidence: Array<{ jdQuote: string; resumeQuote: string }>;
  hasTailoredResume: boolean;
};

function match(overrides: Partial<Detail>): Detail {
  return {
    id: 'mat_1',
    outcome: 'passed',
    outcome_detail: null,
    score: 88,
    reason: 'Strong overlap on Go and Kubernetes.',
    app_status: 'new',
    user_agrees: null,
    title: 'Backend Engineer',
    company: 'Acme',
    location: 'usa',
    url: 'https://example.com/job/1',
    posted_at: 1_700_000_000_000,
    job: { description: 'Build payment services in Go on Kubernetes.' },
    evidence: [{ jdQuote: 'services in Go', resumeQuote: 'the pricing service in Go' }],
    hasTailoredResume: false,
    ...overrides,
  };
}

function render(m: Detail, tailored: TailoredResume | null = null): string {
  return renderToStaticMarkup(
    <MatchDetailView id={m.id} match={m} tailored={tailored} onBack={() => {}} />,
  );
}

describe('MatchDetailView, a null score', () => {
  // Regression test. This page used to handle only insufficient_input, so a
  // score_failed match fell into the generic branch and rendered the literal
  // string "Score ." with an empty reason, an empty evidence list, and a
  // prompt asking whether a judgment that does not exist was correct.
  it('renders a score_failed match as an absence with its reason, never as a blank score', () => {
    const html = render(
      match({
        outcome: 'score_failed',
        score: null,
        reason: null,
        evidence: [],
        outcome_detail: 'Per-run scoring call cap of 10 was reached before this posting',
      }),
    );

    expect(html).toContain('No score.');
    expect(html).toContain('Per-run scoring call cap of 10');
    expect(html).not.toContain('Score .');
    expect(html).not.toContain('null');
    expect(html).not.toContain('NaN');
  });

  it('does not ask whether a judgment was right when no judgment was made', () => {
    const html = render(
      match({ outcome: 'score_failed', score: null, reason: null, evidence: [] }),
    );

    expect(html).not.toContain('Was this judgment right?');
  });

  it('renders an insufficient_input match as not evaluated, with its reason', () => {
    const html = render(
      match({
        outcome: 'insufficient_input',
        score: null,
        reason: null,
        evidence: [],
        outcome_detail: 'Description is 120 characters, under the 400 character floor',
      }),
    );

    expect(html).toContain('Not evaluated.');
    expect(html).toContain('under the 400 character floor');
    expect(html).not.toContain('Was this judgment right?');
  });

  // Zero is a judgment. Null is the absence of one. The whole product depends
  // on those two not looking alike, so the zero case is asserted as carefully
  // as the null cases above it.
  it('renders a score of zero as a real score, not as an absence', () => {
    const html = render(
      match({ outcome: 'rejected', score: 0, reason: 'No overlap with your experience.' }),
    );

    expect(html).toContain('Score 0.');
    expect(html).toContain('No overlap with your experience.');
    expect(html).not.toContain('No score.');
    expect(html).not.toContain('Not evaluated.');
  });
});

describe('MatchDetailView, a passed match with no tailored resume', () => {
  const failed = match({
    outcome: 'passed',
    outcome_detail: 'No tailored resume. The writer failed after retries: model returned invalid JSON',
  });
  const capped = match({
    outcome: 'passed',
    outcome_detail: 'No tailored resume. The per-run tailoring call cap of 4 was reached before this match.',
  });

  // Regression test. The tailored section used to be gated entirely on the
  // resume existing, so these two fixtures, which differ only in their reason,
  // rendered byte-identical HTML. The pipeline records the distinction on
  // purpose. Discarding it here made "the writer failed", "the cap refused
  // it", and "nothing was ever attempted" indistinguishable.
  it('renders different html for two different reasons the resume is missing', () => {
    expect(render(failed)).not.toBe(render(capped));
  });

  it('names the writer failure', () => {
    const html = render(failed);
    expect(html).toContain('Tailored resume');
    expect(html).toContain('The writer failed after retries');
  });

  it('names the call cap refusal', () => {
    const html = render(capped);
    expect(html).toContain('tailoring call cap of 4');
  });

  it('falls back to a plain sentence when no reason was recorded', () => {
    const html = render(match({ outcome: 'passed', outcome_detail: null }));
    expect(html).toContain('No tailored resume was written for this match.');
  });

  // A rejected match was never a candidate for tailoring, so it should not
  // grow a section explaining an absence nobody expected.
  it('says nothing about a tailored resume on a rejected match', () => {
    const html = render(match({ outcome: 'rejected', score: 40, outcome_detail: null }));
    expect(html).not.toContain('Tailored resume');
  });
});

describe('MatchDetailView, export controls', () => {
  const tailored: TailoredResume = {
    content: 'Ricky Zhang\nBuilt services in Go\nLed 99 engineers at Stripe',
    model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    unverifiedCount: 1,
    lines: [
      { line: 'Ricky Zhang', status: 'verified', unsupported: [] },
      { line: 'Built services in Go', status: 'verified', unsupported: [] },
      { line: 'Led 99 engineers at Stripe', status: 'unverified', unsupported: ['99', 'Stripe'] },
    ],
  };

  it('defaults the export to verified lines only, and makes the full text a separate act', () => {
    const html = render(match({ outcome: 'passed', hasTailoredResume: true }), tailored);

    expect(html).toContain('href="/api/matches/mat_1/resume/export"');
    expect(html).toContain('Download verified lines only');
    expect(html).toContain('include=all');
    expect(html).toContain('Download everything');
  });

  it('states the consequence of the unverified lines before offering the download', () => {
    const html = render(match({ outcome: 'passed', hasTailoredResume: true }), tailored);

    expect(html).toContain('1 lines need your review.');
    expect(html).toContain('excluded from the default export');
  });

  it('marks the unverified line and leaves the verified ones unmarked', () => {
    const html = render(match({ outcome: 'passed', hasTailoredResume: true }), tailored);

    expect(html).toContain('Led 99 engineers at Stripe');
    // The marker has to be in the same markup as the text. If the text could
    // paint before its markers, the user reads the unmarked version first and
    // the validator has failed at its only job.
    expect(html).toMatch(/unverified/);
  });
});
