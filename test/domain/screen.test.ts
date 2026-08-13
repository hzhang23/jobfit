import { describe, expect, it } from 'vitest';
import {
  MIN_DESCRIPTION_CHARS,
  MIN_UNIQUE_TOKENS,
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
    expect(stripHtml('R&amp;D&nbsp;team')).toBe('R&D team');
  });

  // Decoding can turn text into markup, so stripping has to happen again
  // afterwards. Without a second pass an encoded tag reappears in the output.
  it('does not let encoded markup reappear after decoding', () => {
    expect(stripHtml('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe('');
    expect(stripHtml('Before &lt;b&gt;bold&lt;/b&gt; after')).toBe('Before bold after');
  });

  // &amp;lt; means the literal text &lt;, not a less-than sign. Decoding &amp;
  // last is what keeps that from being decoded twice into a real tag.
  it('does not double decode an escaped ampersand', () => {
    expect(stripHtml('Use &amp;lt;b&amp;gt; to bold')).toBe('Use &lt;b&gt; to bold');
  });

  // Truncated feed HTML is exactly the malformed input this module guards against.
  it('removes an unclosed script body', () => {
    expect(stripHtml('Real content <script>alert(1)')).toBe('Real content');
  });

  it('leaves a bare less-than sign in prose alone', () => {
    expect(stripHtml('latency < 100ms')).toBe('latency < 100ms');
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

  it('rejects one character below the floor', () => {
    const result = screenPosting({ ...base, description: 'x'.repeat(MIN_DESCRIPTION_CHARS - 1) });
    expect(result).toMatchObject({ ok: false, detail: expect.stringContaining('399 characters') });
  });

  // The true positive at the boundary. Without this the suite could pass while
  // screenPosting rejected everything, since every other case here is a
  // rejection or uses a description far longer than the floor.
  it('accepts a description at exactly the character floor', () => {
    const distinct = Array.from({ length: 45 }, (_, i) => `word${i}`).join(' ');
    const padded = `${distinct} ${'x'.repeat(MIN_DESCRIPTION_CHARS - distinct.length - 1)}`;

    expect(padded).toHaveLength(MIN_DESCRIPTION_CHARS);
    expect(uniqueTokenCount(padded)).toBeGreaterThanOrEqual(MIN_UNIQUE_TOKENS);
    expect(screenPosting({ ...base, description: padded })).toEqual({ ok: true });
  });

  it('rejects a long description made of one repeated word', () => {
    const result = screenPosting({ ...base, description: 'x'.repeat(MIN_DESCRIPTION_CHARS) });
    expect(result).toMatchObject({ ok: false, detail: expect.stringContaining('unique words') });
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
