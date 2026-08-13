// Regenerates the Section 4 and Section 5 submission files from the IMPACT
// Living Document, which is the single source of truth for both.
//
// They are submitted as separate files because the assignment asks for three
// separate things. They are generated rather than written because the same
// prose living in two places is the drift problem this project already solved
// once, when the failure mode map existed as both a standalone file and a
// chapter of the living document.
//
// Run: npm run build:submission

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'docs/IMPACT-Living-Document.md'), 'utf8');

/** Everything from one `## Section N` heading up to the next one, or the end. */
function extractSection(n) {
  const start = source.indexOf(`## Section ${n}:`);
  if (start === -1) throw new Error(`Section ${n} not found in the living document`);
  const next = source.indexOf(`\n## Section ${n + 1}:`, start);
  const body = next === -1 ? source.slice(start) : source.slice(start, next);
  // Promote every heading one level, since the file now stands alone rather
  // than nesting under the living document's title. One pass over all of them,
  // because chained replacements would shift a heading twice: `#### ` becomes
  // `### `, and then the rule for `### ` would catch it again.
  return body
    .replace(/^(#{2,6}) /gm, (_, hashes) => `${hashes.slice(1)} `)
    .replace(/\n+---\s*$/, '')
    .trimEnd();
}

// The reader-facing note goes in the document itself. The "do not edit this
// file" note is for whoever opens it in the repository, and would be noise at
// the top of a submitted PDF, so it is an HTML comment: visible in the raw
// file, invisible once rendered.
const PREAMBLE = (n) => `<!--
  GENERATED FILE. Do not edit.
  Source: docs/IMPACT-Living-Document.md, Section ${n}.
  Regenerate: npm run build:submission
-->

> Section ${n} of the IMPACT Living Document, submitted separately because the
> assignment asks for it separately. The full document, including how the
> reasoning here revised Sections 1 and 2, is at
> [docs/IMPACT-Living-Document.md](../docs/IMPACT-Living-Document.md).

`;

mkdirSync(join(root, 'submission'), { recursive: true });

const targets = [
  [4, '2-failure-mode-map.md'],
  [5, '3-tradeoffs-table.md'],
];

for (const [n, file] of targets) {
  const out = PREAMBLE(n) + extractSection(n) + '\n';
  if (out.includes('—')) {
    throw new Error(`Em dash found in ${file}. Fix it in the living document.`);
  }
  writeFileSync(join(root, 'submission', file), out);
  console.log(`wrote submission/${file}`);
}
