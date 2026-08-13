export interface Prefs {
  keywords: string;
  geo: string;
  min_score: number;
  max_jobs_per_run: number;
  schedule_enabled: number;
  schedule_hour_utc: number;
}

export interface Receipt {
  fetched: number;
  alreadySeen: number;
  unparseable: number;
  insufficient: number;
  scored: number;
  passed: number;
  rejected: number;
  scoreFailed: number;
  notAttempted: number;
  topRejectedScore: number | null;
}

export interface Run {
  id: string;
  status: 'running' | 'succeeded' | 'degraded' | 'failed';
  started_at: number;
  finished_at: number | null;
  error: string | null;
  usage: { calls: number; tokensIn: number; tokensOut: number };
  receipt: Receipt;
}

export interface Match {
  id: string;
  outcome: 'insufficient_input' | 'rejected' | 'passed' | 'score_failed' | 'not_attempted';
  outcome_detail: string | null;
  score: number | null;
  reason: string | null;
  app_status: 'new' | 'interested' | 'applied' | 'rejected';
  user_agrees: number | null;
  title: string;
  company: string;
  location: string | null;
  url: string;
  posted_at: number | null;
}

export interface ProvenanceLine {
  line: string;
  status: 'verified' | 'unverified';
  unsupported: string[];
}

export interface TailoredResume {
  content: string;
  model: string;
  unverifiedCount: number;
  lines: ProvenanceLine[];
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  me: () => req<{ prefs: Prefs; resume: { version: number; charCount: number } | null }>('/me'),
  saveResume: (content: string) =>
    req<{ version: number }>('/resume', { method: 'PUT', body: JSON.stringify({ content }) }),
  savePrefs: (patch: Partial<Prefs>) =>
    req<Prefs>('/prefs', { method: 'PUT', body: JSON.stringify(patch) }),
  startRun: () => req<{ runId: string }>('/runs', { method: 'POST' }),
  // GET /runs returns rows without a receipt. Only GET /runs/:id computes one.
  listRuns: () => req<Omit<Run, 'receipt' | 'usage'>[]>('/runs'),
  getRun: (id: string) => req<Run>(`/runs/${id}`),
  listMatches: (query = '') => req<Match[]>(`/matches${query}`),
  getMatch: (id: string) =>
    req<Match & { job: { description: string }; evidence: Array<{ jdQuote: string; resumeQuote: string }>; hasTailoredResume: boolean }>(
      `/matches/${id}`,
    ),
  getTailored: (id: string) => req<TailoredResume>(`/matches/${id}/resume`),
  setStatus: (id: string, status: Match['app_status']) =>
    req<{ ok: true }>(`/matches/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
  setFeedback: (id: string, agrees: boolean) =>
    req<{ ok: true }>(`/matches/${id}/feedback`, { method: 'POST', body: JSON.stringify({ agrees }) }),
};
