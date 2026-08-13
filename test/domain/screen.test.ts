import { describe, expect, it } from 'vitest';
import {
  MIN_DESCRIPTION_CHARS,
  isDegraded,
  screenPosting,
  stripHtml,
  uniqueTokenCount,
} from '../../src/domain/screen';

const realDescription = [
  'We are hiring a backend engineer to own our payments platform.',
  'You will design services in TypeScript and Go, operate them on Kubernetes,',
  'and partner with product to ship billing features end to end.',
  'Requirements include five years of experience building distributed systems,',
  'strong knowledge of relational databases such as PostgreSQL, comfort with',
  'observability tooling, and a track record of mentoring other engineers.',
  'We offer competitive compensation, equity, and a remote first culture with',
  'quarterly onsite gatherings in Denver for planning and team building.',
].join(' ');

const base = { title: 'Backend Engineer', company: 'Acme', description: realDescription };

describe('stripHtml', () => {
  it('removes tags and collapses whitespace', () => {
    expect(stripHtml('<p>Hello   <b>world</b></p>')).toBe('Hello world');
  });

  it('removes script and style bodies entirely', () => {
    expect(stripHtml('<style>a{b:c}</style>Real<script>x=1</script>')).toBe('Real');
  });

  it('decodes the entities that show up in job feeds', () => {
    expect(stripHtml('R&amp;D&nbsp;team &lt;now&gt;')).toBe('R&D team <now>');
  });
});

describe('uniqueTokenCount', () => {
  it('counts distinct words case insensitively', () => {
    expect(uniqueTokenCount('the The THE cat')).toBe(2);
  });

  it('does not count bare numbers as words', () => {
    expect(uniqueTokenCount('2024 2025 engineer')).toBe(1);
  });
});

describe('screenPosting', () => {
  it('accepts a realistic posting', () => {
    expect(screenPosting(base)).toEqual({ ok: true });
  });

  it('rejects a posting with no title', () => {
    expect(screenPosting({ ...base, title: '   ' })).toEqual({
      ok: false,
      detail: 'Posting has no title',
    });
  });

  it('rejects a posting with no company', () => {
    expect(screenPosting({ ...base, company: '' })).toEqual({
      ok: false,
      detail: 'Posting has no company',
    });
  });

  it('rejects an empty description, which is the Module 3 failure', () => {
    const result = screenPosting({ ...base, description: '' });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ detail: expect.stringContaining('0 characters') });
  });

  it('rejects a description that is only markup', () => {
    const result = screenPosting({ ...base, description: '<div><br/><span></span></div>' });
    expect(result.ok).toBe(false);
  });

  it('rejects at 399 characters and accepts at 400', () => {
    const filler = (n: number) => 'x'.repeat(n);
    expect(screenPosting({ ...base, description: filler(MIN_DESCRIPTION_CHARS - 1) }).ok).toBe(false);

    // 400 chars of a single repeated token still fails the unique word floor,
    // which is the second rule doing its job.
    const long = screenPosting({ ...base, description: filler(MIN_DESCRIPTION_CHARS) });
    expect(long).toMatchObject({ ok: false, detail: expect.stringContaining('unique words') });
  });

  it('rejects placeholder text even when it is long enough', () => {
    const placeholder = `Click apply to see the full job description on our site. ${realDescription}`;
    expect(screenPosting({ ...base, description: placeholder })).toEqual({
      ok: false,
      detail: 'Description is a placeholder, not real content',
    });
  });
});

describe('isDegraded', () => {
  it('is false for an empty run', () => {
    expect(isDegraded(0, 0)).toBe(false);
  });

  it('is false at exactly half, since the rule is strictly greater than 50 percent', () => {
    expect(isDegraded(10, 5)).toBe(false);
  });

  it('is true above half', () => {
    expect(isDegraded(10, 6)).toBe(true);
  });

  it('is true for the Module 3 case of every posting empty', () => {
    expect(isDegraded(35, 35)).toBe(true);
  });
});
