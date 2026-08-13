import { useEffect, useState } from 'react';
import { api, type Match, type Run } from '../api';
import { RunReceipt } from '../components/RunReceipt';

export function Dashboard({ onOpen }: { onOpen: (id: string) => void }) {
  const [run, setRun] = useState<Run | null>(null);
  const [passed, setPassed] = useState<Match[]>([]);
  const [rejectedSample, setRejectedSample] = useState<Match[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const runs = await api.listRuns();
    if (runs[0]) setRun(await api.getRun(runs[0].id));
    setPassed(await api.listMatches('?outcome=passed'));
    // Deliberate: a sample of the negative class is always on screen, because
    // a drifting scorer hides in what nobody inspects.
    setRejectedSample((await api.listMatches('?outcome=rejected&limit=2')).slice(0, 2));
  }

  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (run?.status !== 'running') return;
    const timer = setInterval(() => refresh().catch(() => {}), 2000);
    return () => clearInterval(timer);
  }, [run?.status]);

  async function startRun() {
    setBusy(true);
    setError(null);
    try {
      const { runId } = await api.startRun();
      setRun(await api.getRun(runId));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <button className="primary" onClick={startRun} disabled={busy}>
        {busy ? 'Starting' : 'Run now'}
      </button>

      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}

      <div style={{ marginTop: 20 }}>
        {run ? <RunReceipt run={run} /> : <p>No runs yet. Press Run now to start one.</p>}
      </div>

      <p className="section-label">Matches</p>
      {passed.map((m) => (
        <div key={m.id} className="card" onClick={() => onOpen(m.id)}>
          <span className="score">{m.score}</span>
          <h3>
            {m.title} at {m.company}
          </h3>
          <p className="reason">{m.reason}</p>
        </div>
      ))}

      {rejectedSample.length > 0 && (
        <>
          <p className="section-label">We said no to these</p>
          {rejectedSample.map((m) => (
            <div key={m.id} className="card" onClick={() => onOpen(m.id)}>
              <span className="score">{m.score}</span>
              <h3>
                {m.title} at {m.company}
              </h3>
              <p className="reason">{m.reason}</p>
            </div>
          ))}
        </>
      )}
    </main>
  );
}
