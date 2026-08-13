export type LineStatus = 'verified' | 'unverified';

export interface ProvenanceLine {
  line: string;
  status: LineStatus;
  unsupported: string[];
}

export interface ProvenanceReport {
  lines: ProvenanceLine[];
  unverifiedCount: number;
}

/**
 * Canonical skill name to the abbreviations a rewriting model is likely to
 * substitute. Kept deliberately small. Every entry here is a place where the
 * validator chooses not to flag, so the list stays short and reviewable.
 */
const SYNONYMS: Record<string, string[]> = {
  javascript: ['js'],
  typescript: ['ts'],
  postgresql: ['postgres', 'psql'],
  kubernetes: ['k8s'],
  'amazon web services': ['aws'],
  'google cloud platform': ['gcp'],
  'continuous integration': ['ci'],
};

function normalize(token: string): string {
  return token.toLowerCase().replace(/[^a-z0-9.]/g, '');
}

function stripBullet(line: string): string {
  return line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '');
}

/**
 * A claim is a specific, checkable fact. Ordinary prose is not a claim, so
 * rewording is allowed and only invented specifics get flagged.
 *
 * Over-flagging is acceptable here by design. A false positive costs five
 * seconds of reading. A false negative can cost an interview.
 */
export function extractClaims(line: string): string[] {
  const claims = new Set<string>();
  const body = stripBullet(line);

  // Anything containing a digit: 45%, 3,000, $1.2M, 2023, S3, GPT-4.
  for (const m of body.matchAll(/\b[$]?\d[\w.,%+/-]*/g)) {
    const cleaned = m[0].replace(/[.,]+$/, '');
    if (cleaned) claims.add(cleaned);
  }

  // Acronyms: two or more consecutive capitals.
  for (const m of body.matchAll(/\b[A-Z]{2,}[A-Z0-9]*\b/g)) {
    claims.add(m[0]);
  }

  // Single-letter abbreviations with digits: K8s, S3, etc.
  for (const m of body.matchAll(/\b[A-Z]\d[a-z]?\b/g)) {
    claims.add(m[0]);
  }

  // Proper nouns, skipping the first word of each sentence so that an
  // ordinary capitalized sentence opener is not treated as a claim.
  for (const sentence of body.split(/(?<=[.!?:])\s+/)) {
    const words = sentence.trim().split(/\s+/);
    for (let i = 1; i < words.length; i++) {
      const word = (words[i] ?? '').replace(/^[^\w]+/, '').replace(/[^\w.]+$/, '');
      if (/^[A-Z][A-Za-z.]{2,}$/.test(word)) claims.add(word);
    }
  }

  return [...claims];
}

export function buildMasterIndex(master: string): Set<string> {
  const index = new Set<string>();
  for (const m of master.matchAll(/[\w$%.,+/-]+/g)) {
    const n = normalize(m[0]);
    if (n) index.add(n);
    // Also index a trailing-punctuation-free variant, so "3,000." and "3,000"
    // both resolve to 3000.
    const trimmed = normalize(m[0].replace(/[.,]+$/, ''));
    if (trimmed) index.add(trimmed);
  }
  return index;
}

/** Every spelling under which a claim may legitimately appear in the master. */
function candidates(token: string): string[] {
  const n = normalize(token);
  const out = new Set<string>([n]);
  for (const [canonical, aliases] of Object.entries(SYNONYMS)) {
    const canonicalN = normalize(canonical);
    const aliasesN = aliases.map(normalize);
    if (n === canonicalN || aliasesN.includes(n)) {
      out.add(canonicalN);
      for (const a of aliasesN) out.add(a);
    }
  }
  return [...out];
}

export function verifyProvenance(
  master: string,
  tailored: string,
): ProvenanceReport {
  const index = buildMasterIndex(master);
  const lines: ProvenanceLine[] = [];
  let unverifiedCount = 0;

  for (const line of tailored.split('\n')) {
    if (!line.trim()) {
      lines.push({ line, status: 'verified', unsupported: [] });
      continue;
    }
    const unsupported = extractClaims(line).filter(
      (claim) => !candidates(claim).some((variant) => index.has(variant)),
    );
    const status: LineStatus = unsupported.length === 0 ? 'verified' : 'unverified';
    if (status === 'unverified') unverifiedCount++;
    lines.push({ line, status, unsupported });
  }

  return { lines, unverifiedCount };
}

/** What the export endpoint returns when include=verified, which is the default. */
export function verifiedOnly(report: ProvenanceReport): string {
  return report.lines
    .filter((l) => l.status === 'verified')
    .map((l) => l.line)
    .join('\n')
    .trim();
}
