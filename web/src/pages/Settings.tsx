import { useEffect, useState } from 'react';
import { api, type Match, type Prefs } from '../api';

export function Settings() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [status, setStatus] = useState('');
  const [reviewed, setReviewed] = useState<Match[]>([]);

  useEffect(() => {
    api.me().then((m) => setPrefs(m.prefs));
    api.listMatches().then((all) => setReviewed(all.filter((m) => m.user_agrees !== null)));
  }, []);

  if (!prefs) return <main>Loading</main>;

  const disagreements = reviewed.filter((m) => m.user_agrees === 0).length;

  const set = <K extends keyof Prefs>(key: K, value: Prefs[K]) =>
    setPrefs({ ...prefs, [key]: value });

  async function save() {
    try {
      setPrefs(await api.savePrefs(prefs!));
      setStatus('Saved');
    } catch (e) {
      setStatus(String(e));
    }
  }

  return (
    <main>
      <h2>Settings</h2>

      <label>Keywords</label>
      <input type="text" value={prefs.keywords} onChange={(e) => set('keywords', e.target.value)} />

      <label>Country</label>
      <input type="text" value={prefs.geo} onChange={(e) => set('geo', e.target.value)} />

      <label>Score threshold</label>
      <input type="number" value={prefs.min_score} onChange={(e) => set('min_score', Number(e.target.value))} />

      <label>Postings per run</label>
      <input type="number" value={prefs.max_jobs_per_run} onChange={(e) => set('max_jobs_per_run', Number(e.target.value))} />

      <label>Daily run hour, UTC</label>
      <input type="number" value={prefs.schedule_hour_utc} onChange={(e) => set('schedule_hour_utc', Number(e.target.value))} />

      <label>
        <input
          type="checkbox"
          checked={prefs.schedule_enabled === 1}
          onChange={(e) => set('schedule_enabled', e.target.checked ? 1 : 0)}
        />{' '}
        Run automatically every day
      </label>

      <p>
        <button className="primary" onClick={save}>
          Save
        </button>{' '}
        {status}
      </p>

      {reviewed.length >= 5 && (
        <>
          <p className="section-label">Calibration</p>
          <p>
            Of your last {reviewed.length} reviewed decisions you disagreed with {disagreements}.
            {disagreements / reviewed.length > 0.3
              ? ' Your threshold may need adjusting.'
              : ' The threshold looks reasonable.'}
          </p>
        </>
      )}
    </main>
  );
}
