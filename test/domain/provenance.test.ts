import { describe, expect, it } from 'vitest';
import {
  buildMasterIndex,
  extractClaims,
  verifiedOnly,
  verifyProvenance,
} from '../../src/domain/provenance';

const master = [
  'Ricky Zhang',
  'Software Engineer, Acme Corp, 2021 to 2024',
  '- Reduced checkout latency by 20% by rewriting the pricing service in Go',
  '- Built an ETL pipeline on AWS processing 3,000 events per second',
  '- Mentored 4 junior engineers and led the JavaScript style guide rewrite',
  'Skills: TypeScript, PostgreSQL, Kubernetes, React',
].join('\n');

describe('extractClaims', () => {
  it('pulls out numbers, percentages, and years', () => {
    const claims = extractClaims('Reduced latency by 45% across 12 services in 2023');
    expect(claims).toEqual(expect.arrayContaining(['45%', '12', '2023']));
  });

  it('pulls out acronyms', () => {
    expect(extractClaims('Deployed on AWS using EKS')).toEqual(
      expect.arrayContaining(['AWS', 'EKS']),
    );
  });

  it('pulls out mid-sentence proper nouns', () => {
    expect(extractClaims('Senior Engineer at Stripe')).toContain('Stripe');
  });

  it('ignores the first word of a line so ordinary sentences are not flagged', () => {
    expect(extractClaims('Reduced the cost of the service')).toEqual([]);
  });

  it('ignores the first word after a bullet marker', () => {
    expect(extractClaims('- Improved the deployment process')).toEqual([]);
  });
});

describe('buildMasterIndex', () => {
  it('normalizes away punctuation so 3,000 and 3000 are the same claim', () => {
    const index = buildMasterIndex('Processed 3,000 events');
    expect(index.has('3000')).toBe(true);
  });
});

describe('verifyProvenance', () => {
  it('verifies a line whose numbers all appear in the master resume', () => {
    const report = verifyProvenance(master, 'Reduced checkout latency by 20% in Go');
    expect(report.unverifiedCount).toBe(0);
    expect(report.lines[0]?.status).toBe('verified');
  });

  it('flags an invented number', () => {
    const report = verifyProvenance(master, 'Reduced checkout latency by 45%');
    expect(report.unverifiedCount).toBe(1);
    expect(report.lines[0]?.unsupported).toContain('45%');
  });

  it('flags an invented employer', () => {
    const report = verifyProvenance(master, 'Senior Engineer at Stripe, 2024 to 2025');
    expect(report.lines[0]?.unsupported).toContain('Stripe');
  });

  it('flags an inflated headcount', () => {
    const report = verifyProvenance(master, 'Mentored 14 junior engineers');
    expect(report.lines[0]?.unsupported).toContain('14');
  });

  it('accepts a known abbreviation of a skill in the master resume', () => {
    const report = verifyProvenance(master, 'Wrote the JS style guide');
    expect(report.unverifiedCount).toBe(0);
  });

  it('accepts K8s as Kubernetes', () => {
    const report = verifyProvenance(master, 'Operated services on K8s');
    expect(report.unverifiedCount).toBe(0);
  });

  it('treats blank lines as verified', () => {
    const report = verifyProvenance(master, 'Skills: TypeScript\n\nSkills: React');
    expect(report.unverifiedCount).toBe(0);
    expect(report.lines).toHaveLength(3);
  });

  it('counts each unverified line once regardless of how many claims failed', () => {
    const report = verifyProvenance(master, 'Led 99 engineers at Stripe using Rust');
    expect(report.unverifiedCount).toBe(1);
    expect(report.lines[0]?.unsupported.length).toBeGreaterThan(1);
  });

  // DOCUMENTED LIMITATION, recorded in Section 4 A2 and the eval plan.
  // Deterministic claim extraction catches invented specifics. It does not
  // catch semantic drift that introduces no new tokens. This test exists so
  // the gap stays visible rather than being rediscovered later.
  it('does NOT catch semantic drift that introduces no new tokens', () => {
    const drifted = verifyProvenance(master, 'Led 4 junior engineers');
    expect(drifted.unverifiedCount).toBe(0);
  });
});

describe('verifiedOnly', () => {
  it('drops unverified lines, which is what export does by default', () => {
    const report = verifyProvenance(
      master,
      'Reduced checkout latency by 20%\nReduced checkout latency by 45%',
    );
    expect(verifiedOnly(report)).toBe('Reduced checkout latency by 20%');
  });
});
