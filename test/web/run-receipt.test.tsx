import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Receipt, Run } from '../../web/src/api';
import { RunReceipt } from '../../web/src/components/RunReceipt';

function receipt(overrides: Partial<Receipt>): Receipt {
  return {
    fetched: 0,
    alreadySeen: 0,
    unparseable: 0,
    insufficient: 0,
    scored: 0,
    passed: 0,
    rejected: 0,
    scoreFailed: 0,
    notAttempted: 0,
    topRejectedScore: null,
    ...overrides,
  };
}

function run(status: Run['status'], r: Receipt, error: string | null = null): Run {
  return {
    id: 'run_1',
    status,
    started_at: 1_700_000_000_000,
    finished_at: 1_700_000_060_000,
    error,
    usage: { calls: 4, tokensIn: 8000, tokensOut: 400 },
    receipt: r,
  };
}

function render(r: Run): string {
  return renderToStaticMarkup(<RunReceipt run={r} />);
}

/** Strips tags so an assertion reads the sentence a user actually sees. */
function text(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

describe('RunReceipt always says which kind of nothing it was', () => {
  it('a healthy run with passes reports the counts', () => {
    const t = text(render(run('succeeded', receipt({ fetched: 20, alreadySeen: 6, insufficient: 3, scored: 11, passed: 2, rejected: 9, topRejectedScore: 64 }))));

    expect(t).toContain('20 fetched');
    expect(t).toContain('6 already seen');
    expect(t).toContain('11 scored');
    expect(t).toContain('2 passed');
    expect(t).not.toContain('not trustworthy');
  });

  it('zero passes with postings scored explains the threshold, citing a real highest score', () => {
    const t = text(render(run('succeeded', receipt({ fetched: 10, alreadySeen: 0, scored: 10, rejected: 10, topRejectedScore: 58 }))));

    expect(t).toContain('10 postings were scored');
    expect(t).toContain('58');
    expect(t).toContain('did not clear your threshold');
  });

  it('zero passes because every scoring call failed says it was a scoring failure', () => {
    const t = text(render(run('degraded', receipt({ fetched: 3, alreadySeen: 0, scored: 0, scoreFailed: 3 }))));

    expect(t).toContain('reached the scorer');
    expect(t).toContain('not a quiet day');
    expect(t).not.toContain('postings were scored. The highest');
  });

  it('nothing fetched says it is a fetch problem', () => {
    const t = text(render(run('succeeded', receipt({ fetched: 0 }))));

    expect(t).toContain('Nothing came back from the job source');
    expect(t).toContain('not a quiet day');
  });

  it('everything already seen says so rather than rendering an empty state', () => {
    const t = text(render(run('succeeded', receipt({ fetched: 8, alreadySeen: 8 }))));

    expect(t).toContain('Nothing reached the scorer');
    expect(t).toContain('already seen or unusable');
  });

  // The original incident wearing different clothes. If the adapter cannot
  // parse what came back, fetched is zero because fetched counts postings that
  // parsed. Without the unparseable branch this run reads as an ordinary
  // fetch problem, which would send someone looking in the wrong place.
  it('rows that came back unreadable are reported as a source shape change', () => {
    const t = text(render(run('degraded', receipt({ fetched: 0, unparseable: 18 }))));

    expect(t).toContain('18 rows came back and none of them could be read');
    expect(t).toContain('changed shape');
  });

  it('a failed run shows its error', () => {
    const t = text(render(run('failed', receipt({ fetched: 0 }), 'No active master resume')));

    expect(t).toContain('This run failed.');
    expect(t).toContain('No active master resume');
  });
});

describe('RunReceipt never cites a highest score it does not have', () => {
  const noScores: Array<[string, Receipt]> = [
    ['every scoring call failed', receipt({ fetched: 3, scored: 0, scoreFailed: 3 })],
    ['nothing was fetched', receipt({ fetched: 0, scored: 0 })],
    ['everything was already seen', receipt({ fetched: 5, alreadySeen: 5, scored: 0 })],
    ['everything was unreadable', receipt({ fetched: 0, unparseable: 7, scored: 0 })],
    ['every description was empty', receipt({ fetched: 4, insufficient: 4, scored: 0 })],
  ];

  for (const [name, r] of noScores) {
    it(`says nothing about a highest score when ${name}`, () => {
      const t = text(render(run('succeeded', r)));
      expect(t).not.toContain('The highest was');
      expect(t).not.toContain('not recorded');
    });
  }
});

describe('RunReceipt names the cause when a run is degraded', () => {
  it('empty descriptions only', () => {
    const t = text(render(run('degraded', receipt({ fetched: 10, alreadySeen: 0, insufficient: 8, scored: 2, passed: 1, rejected: 1 }))));

    expect(t).toContain('not trustworthy');
    expect(t).toContain('8 of 10 postings produced no judgment');
    expect(t).toContain('8 arrived without a usable description');
    expect(t).not.toContain('could not be scored');
  });

  it('scoring failures only', () => {
    const t = text(render(run('degraded', receipt({ fetched: 6, alreadySeen: 0, scored: 2, passed: 1, rejected: 1, scoreFailed: 4 }))));

    expect(t).toContain('4 of 6 postings produced no judgment');
    expect(t).toContain('4 could not be scored');
    expect(t).not.toContain('without a usable description');
  });

  it('unreadable rows only', () => {
    const t = text(render(run('degraded', receipt({ fetched: 2, alreadySeen: 0, unparseable: 9, scored: 2, passed: 1, rejected: 1 }))));

    expect(t).toContain('9 of 11 postings produced no judgment');
    expect(t).toContain('9 could not be read at all');
  });

  it('all three causes at once, each with its own number', () => {
    const t = text(render(run('degraded', receipt({ fetched: 8, alreadySeen: 0, unparseable: 2, insufficient: 3, scored: 1, passed: 0, rejected: 1, scoreFailed: 4 }))));

    // 2 unreadable + 3 no description + 4 unscoreable = 9, out of 9 + 1 scored.
    expect(t).toContain('9 of 10 postings produced no judgment');
    expect(t).toContain('2 could not be read at all');
    expect(t).toContain('3 arrived without a usable description');
    expect(t).toContain('4 could not be scored');
  });

  it('counts unreadable rows on the counts line too, not only in the banner', () => {
    const t = text(render(run('degraded', receipt({ fetched: 2, unparseable: 9, scored: 2, passed: 1, rejected: 1 }))));

    expect(t).toContain('2 fetched, 9 unreadable');
  });

  it('omits the unreadable clause entirely when there are none', () => {
    const t = text(render(run('succeeded', receipt({ fetched: 10, alreadySeen: 2, scored: 8, passed: 3, rejected: 5, topRejectedScore: 60 }))));

    expect(t).not.toContain('unreadable');
    expect(t).toContain('10 fetched, 2 already seen');
  });
});

describe('RunReceipt reports work, never money', () => {
  it('renders no currency figure anywhere', () => {
    const html = render(run('succeeded', receipt({ fetched: 20, alreadySeen: 6, insufficient: 3, scored: 11, passed: 2, rejected: 9, topRejectedScore: 64 })));

    expect(html).not.toMatch(/\$\s*\d/);
    expect(html.toLowerCase()).not.toContain('spend');
    expect(html.toLowerCase()).not.toContain('cost');
  });
});

describe('RunReceipt separates deferred postings from failed ones', () => {
  // Regression test for the finding that mattered most in the final review.
  // Cap-refused postings used to be recorded as score_failed and counted as
  // untrustworthy, so raising postings per run above about 20 made every
  // healthy run report "not trustworthy" forever. A warning that always fires
  // is a warning nobody reads, and this project's entire subject is a warning
  // worth reading.
  it('a run that hit its own call cap is not described as untrustworthy', () => {
    const t = text(
      render(
        run(
          'succeeded',
          receipt({ fetched: 25, alreadySeen: 0, scored: 10, passed: 10, notAttempted: 15 }),
        ),
      ),
    );

    expect(t).not.toContain('not trustworthy');
    expect(t).not.toContain('produced no judgment');
    expect(t).not.toContain('could not be scored');
    expect(t).toContain('15 not attempted');
  });

  it('explains a zero-pass day caused only by the call cap, and says it is recoverable', () => {
    const t = text(
      render(run('succeeded', receipt({ fetched: 20, scored: 0, passed: 0, notAttempted: 20 }))),
    );

    expect(t).toContain("call cap was already spent");
    expect(t).toContain('They are not lost');
    expect(t).not.toContain('not a quiet day');
  });

  it('still says untrustworthy when the cause is a real failure, not the cap', () => {
    const t = text(
      render(
        run(
          'degraded',
          receipt({ fetched: 12, scored: 2, passed: 1, rejected: 1, scoreFailed: 10 }),
        ),
      ),
    );

    expect(t).toContain('not trustworthy');
    expect(t).toContain('10 could not be scored');
  });
});
