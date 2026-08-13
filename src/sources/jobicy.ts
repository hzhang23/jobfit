import type { FetchParams, FetchResult, JobSource, RawPosting } from './types';

const ENDPOINT = 'https://jobicy.com/api/v2/remote-jobs';
const TIMEOUT_MS = 30_000;

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseDate(value: unknown): number | null {
  const raw = str(value);
  if (!raw) return null;
  // Jobicy emits "2026-08-10 09:00:00" with no timezone. Treat it as UTC.
  const iso = raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

function parsePosting(row: unknown): RawPosting | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;

  const sourceId = r.id != null ? String(r.id) : str(r.url);
  if (!sourceId) return null;

  const title = str(r.jobTitle) || str(r.title);
  const url = str(r.url);
  if (!title || !url) return null;

  return {
    sourceId,
    title,
    company: str(r.companyName) || str(r.company),
    location: str(r.jobGeo) || str(r.location),
    url,
    // A null description is not a parse failure. It is a posting we will
    // refuse to score, and the screening gate is where that gets recorded.
    description: str(r.jobDescription) || str(r.jobExcerpt),
    postedAt: parseDate(r.pubDate),
  };
}

export class JobicySource implements JobSource {
  readonly name = 'jobicy';

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async fetch(params: FetchParams): Promise<FetchResult> {
    const url = new URL(ENDPOINT);
    url.searchParams.set('count', String(params.count));
    if (params.geo) url.searchParams.set('geo', params.geo);
    if (params.keywords) url.searchParams.set('tag', params.keywords);

    const response = await this.fetchImpl(url.toString(), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Jobicy returned ${response.status}`);
    }

    const body = (await response.json()) as Record<string, unknown>;
    if (!Array.isArray(body?.jobs)) {
      throw new Error('Jobicy response has no jobs array');
    }

    const postings: RawPosting[] = [];
    let unparseable = 0;
    for (const row of body.jobs) {
      const posting = parsePosting(row);
      if (posting) postings.push(posting);
      else unparseable++;
    }

    return { postings, unparseable };
  }
}
