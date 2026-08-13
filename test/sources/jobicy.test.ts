import { describe, expect, it, vi } from 'vitest';
import { JobicySource } from '../../src/sources/jobicy';
import good from '../fixtures/jobicy-good.json';
import empty from '../fixtures/jobicy-empty.json';

function stubFetch(body: unknown, status = 200) {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  ) as unknown as typeof fetch;
}

const params = { keywords: 'software engineer', geo: 'usa', count: 20 };

describe('JobicySource', () => {
  it('builds the documented query string', async () => {
    const f = stubFetch(good);
    await new JobicySource(f).fetch(params);

    const url = new URL((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string);
    expect(url.origin + url.pathname).toBe('https://jobicy.com/api/v2/remote-jobs');
    expect(url.searchParams.get('count')).toBe('20');
    expect(url.searchParams.get('geo')).toBe('usa');
    expect(url.searchParams.get('tag')).toBe('software engineer');
  });

  it('maps a full posting onto RawPosting', async () => {
    const { postings, unparseable } = await new JobicySource(stubFetch(good)).fetch(params);

    expect(unparseable).toBe(0);
    expect(postings[0]).toMatchObject({
      sourceId: '111',
      title: 'Backend Engineer',
      company: 'Acme',
      location: 'USA',
      url: 'https://jobicy.com/jobs/111-backend-engineer',
    });
    expect(postings[0]?.description).toContain('payments platform');
    expect(postings[0]?.postedAt).toBe(Date.parse('2026-08-10T09:00:00Z'));
  });

  it('falls back to the excerpt when the description is blank', async () => {
    const { postings } = await new JobicySource(stubFetch(good)).fetch(params);
    expect(postings[1]?.description).toBe('Short excerpt only');
  });

  // The Module 3 regression. These postings are useless, but they must arrive
  // as parsed postings so the screening gate can record why they were dropped.
  it('parses postings whose description is null instead of discarding them', async () => {
    const { postings, unparseable } = await new JobicySource(stubFetch(empty)).fetch(params);

    expect(unparseable).toBe(0);
    expect(postings).toHaveLength(2);
    expect(postings.every((p) => p.description === '')).toBe(true);
    expect(postings[0]?.title).toBe('Senior Software Engineer');
  });

  it('counts rows it cannot identify instead of silently skipping them', async () => {
    const messy = { jobs: [{ nothing: 'useful' }, good.jobs[0]] };
    const { postings, unparseable } = await new JobicySource(stubFetch(messy)).fetch(params);

    expect(postings).toHaveLength(1);
    expect(unparseable).toBe(1);
  });

  it('throws when the response is not a jobs array, so the step retries', async () => {
    await expect(
      new JobicySource(stubFetch({ error: 'rate limited' })).fetch(params),
    ).rejects.toThrow(/no jobs array/i);
  });

  it('throws on a non 2xx response', async () => {
    await expect(
      new JobicySource(stubFetch({}, 503)).fetch(params),
    ).rejects.toThrow(/503/);
  });
});
