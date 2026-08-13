import { useEffect, useState } from 'react';
import { api, type TailoredResume } from '../api';
import { ProvenanceText } from '../components/ProvenanceText';

type Detail = Awaited<ReturnType<typeof api.getMatch>>;

export function MatchDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [match, setMatch] = useState<Detail | null>(null);
  const [tailored, setTailored] = useState<TailoredResume | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const detail = await api.getMatch(id);
      // Both loads finish before anything paints, so the resume text and its
      // provenance markers appear together.
      const resume = detail.hasTailoredResume ? await api.getTailored(id) : null;
      if (cancelled) return;
      setMatch(detail);
      setTailored(resume);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!match) return <main>Loading</main>;

  return <MatchDetailView id={id} match={match} tailored={tailored} onBack={onBack} />;
}

/**
 * The presentational body of the match detail page, extracted from
 * `MatchDetail` so it can be rendered directly in tests without going through
 * the `useEffect` data fetch. `MatchDetail` is the only caller in the app;
 * tests import this component to exercise the same markup the app ships.
 */
export function MatchDetailView({
  id,
  match,
  tailored,
  onBack,
}: {
  id: string;
  match: Detail;
  tailored: TailoredResume | null;
  onBack: () => void;
}) {
  return (
    <main>
      <button onClick={onBack}>Back</button>

      <h2>
        {match.title} at {match.company}
      </h2>
      <p>
        <a href={match.url} target="_blank" rel="noreferrer">
          Original posting
        </a>
        {' | '}
        {match.location}
      </p>

      {/*
        Two outcomes carry a null score, and neither may render as a number or
        as a blank. A posting that never reached the model and a posting the
        model could not score are different facts, and both are different from
        a score of zero. outcome_detail already holds the reason in each case,
        computed by the pipeline. Throwing it away here would undo the whole
        point of recording it.
      */}
      {match.outcome === 'insufficient_input' ? (
        <p>
          <strong>Not evaluated.</strong> {match.outcome_detail}
        </p>
      ) : match.outcome === 'score_failed' ? (
        <p>
          <strong>No score.</strong> This posting reached the scorer and came back without a
          judgment. {match.outcome_detail}
        </p>
      ) : (
        <>
          <p>
            <strong>Score {match.score}.</strong> {match.reason}
          </p>
          <p className="section-label">Evidence</p>
          <ul>
            {match.evidence.map((e, i) => (
              <li key={i}>
                Job description says "{e.jdQuote}". Your resume says "{e.resumeQuote}".
              </li>
            ))}
          </ul>
          <p>
            Was this judgment right?{' '}
            <button onClick={() => api.setFeedback(id, true)}>Yes</button>{' '}
            <button onClick={() => api.setFeedback(id, false)}>No</button>
          </p>
        </>
      )}

      {/*
        A passed match with no tailored resume must say why. The pipeline
        records the reason on outcome_detail, distinguishing "the writer
        failed" from "the per-run cap refused it". Rendering nothing at all
        makes those two look identical to each other and to a match that was
        never attempted, which is the same defect as a dashboard that renders
        a bare empty state.
      */}
      {!tailored && match.outcome === 'passed' && (
        <>
          <p className="section-label">Tailored resume</p>
          <p style={{ color: 'var(--warn)' }}>
            {match.outcome_detail ?? 'No tailored resume was written for this match.'}
          </p>
        </>
      )}

      {tailored && (
        <>
          <p className="section-label">Tailored resume</p>
          {tailored.unverifiedCount > 0 && (
            <p style={{ color: 'var(--warn)' }}>
              <strong>{tailored.unverifiedCount} lines need your review.</strong> They contain
              details that do not appear in your master resume. They are excluded from the default
              export.
            </p>
          )}
          <ProvenanceText lines={tailored.lines} />
          <p style={{ marginTop: 16 }}>
            <a href={`/api/matches/${id}/resume/export`}>Download verified lines only</a>
            {' | '}
            <a href={`/api/matches/${id}/resume/export?include=all`}>Download everything</a>
          </p>
        </>
      )}

      <p className="section-label">Application status</p>
      <select
        defaultValue={match.app_status}
        onChange={(e) => api.setStatus(id, e.target.value as typeof match.app_status)}
      >
        {['new', 'interested', 'applied', 'rejected'].map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </main>
  );
}
