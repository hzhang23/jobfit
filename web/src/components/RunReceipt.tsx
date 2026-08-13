import type { Run } from '../api';

/**
 * The product-layer response to failure mode 3.
 *
 * This component never renders "no matches today" on its own. Every zero has
 * to say which kind of zero it is, because a day with nothing good and a day
 * with a broken fetch must not look alike.
 */
export function RunReceipt({ run }: { run: Run }) {
  const r = run.receipt;
  const degraded = run.status === 'degraded';

  return (
    <div className={degraded ? 'receipt degraded' : 'receipt'}>
      {degraded && (
        <p>
          <strong>Today's results are not trustworthy.</strong>{' '}
          {r.insufficient + r.scoreFailed} of {r.insufficient + r.scored + r.scoreFailed}{' '}
          postings produced no judgment at all
          {r.insufficient > 0 && r.scoreFailed > 0
            ? ', some without a usable description and some because the scorer failed'
            : r.insufficient > 0
              ? ', because they arrived without a usable description'
              : ', because the scorer failed on them'}
          .
        </p>
      )}

      {run.status === 'failed' && (
        <p>
          <strong>This run failed.</strong> <code>{run.error}</code>
        </p>
      )}

      <p>
        <code>
          {r.fetched} fetched, {r.alreadySeen} already seen, {r.insufficient} no description,{' '}
          {r.scored} scored, {r.passed} passed
          {r.scoreFailed > 0 ? `, ${r.scoreFailed} could not be scored` : ''}
        </code>
      </p>

      {run.status !== 'running' && r.passed === 0 && (
        <p>
          {r.scored > 0 ? (
            <>
              {r.scored} postings were scored. The highest was{' '}
              {r.topRejectedScore ?? 'not recorded'}, and it did not clear your threshold.
            </>
          ) : r.scoreFailed > 0 ? (
            <>
              {r.scoreFailed} postings reached the scorer and none of them came back with a
              score. This is a scoring failure, not a quiet day.
            </>
          ) : r.fetched === 0 ? (
            <>Nothing came back from the job source. This is a fetch problem, not a quiet day.</>
          ) : (
            <>Nothing reached the scorer. Every posting was either already seen or unusable.</>
          )}
        </p>
      )}

      {/*
        What the run asked the model to do, not what it cost. The app has no
        honest way to produce a cost figure, and a dishonest one on a receipt
        is worse than none.
      */}
      <p>
        <code>
          {run.usage.calls} model {run.usage.calls === 1 ? 'call' : 'calls'},{' '}
          {run.usage.tokensIn.toLocaleString()} tokens in,{' '}
          {run.usage.tokensOut.toLocaleString()} out
          {run.finished_at ? ` in ${Math.round((run.finished_at - run.started_at) / 1000)}s` : ' (running)'}
        </code>
      </p>
    </div>
  );
}
