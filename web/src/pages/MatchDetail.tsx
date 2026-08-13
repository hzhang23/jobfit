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

      {match.outcome === 'insufficient_input' ? (
        <p>
          <strong>Not evaluated.</strong> {match.outcome_detail}
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
