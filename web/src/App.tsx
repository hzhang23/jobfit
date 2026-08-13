import { useState } from 'react';
import { Dashboard } from './pages/Dashboard';
import { MatchDetail } from './pages/MatchDetail';
import { ResumeEditor } from './pages/ResumeEditor';
import { Settings } from './pages/Settings';

type Page = 'dashboard' | 'resume' | 'settings';

export function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [matchId, setMatchId] = useState<string | null>(null);

  const go = (p: Page) => {
    setMatchId(null);
    setPage(p);
  };

  return (
    <>
      <nav>
        <strong style={{ marginRight: 8 }}>JobFit</strong>
        <button aria-current={page === 'dashboard' && !matchId} onClick={() => go('dashboard')}>
          Dashboard
        </button>
        <button aria-current={page === 'resume'} onClick={() => go('resume')}>
          Master resume
        </button>
        <button aria-current={page === 'settings'} onClick={() => go('settings')}>
          Settings
        </button>
      </nav>

      {matchId ? (
        <MatchDetail id={matchId} onBack={() => setMatchId(null)} />
      ) : page === 'dashboard' ? (
        <Dashboard onOpen={setMatchId} />
      ) : page === 'resume' ? (
        <ResumeEditor />
      ) : (
        <Settings />
      )}
    </>
  );
}
