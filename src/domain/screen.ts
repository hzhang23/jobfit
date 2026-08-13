export const MIN_DESCRIPTION_CHARS = 400;
export const MIN_UNIQUE_TOKENS = 40;
export const DEGRADED_RATIO = 0.5;

export type ScreenResult = { ok: true } | { ok: false; detail: string };

/**
 * Phrases that job boards emit in place of a real description when the
 * detail page is gated. A long string of these is not content.
 */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /click apply to see/i,
  /sign in to view/i,
  /description not available/i,
  /view the full (job )?description on/i,
  /apply on the company site to learn more/i,
];

export function stripHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function uniqueTokenCount(text: string): number {
  const tokens = text.toLowerCase().match(/\p{L}[\p{L}\p{N}'-]*/gu) ?? [];
  return new Set(tokens).size;
}

/**
 * The deterministic gate that runs BEFORE the model.
 *
 * The point of this function is that a posting which fails it never reaches
 * the scorer at all. This is not a prompt asking the model to notice thin
 * input, because that still depends on the model behaving. It is a plain
 * function that the model cannot talk its way past.
 */
export function screenPosting(p: {
  title: string;
  company: string;
  description: string;
}): ScreenResult {
  if (!p.title?.trim()) return { ok: false, detail: 'Posting has no title' };
  if (!p.company?.trim()) return { ok: false, detail: 'Posting has no company' };

  const text = stripHtml(p.description ?? '');

  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(text)) {
      return { ok: false, detail: 'Description is a placeholder, not real content' };
    }
  }

  if (text.length < MIN_DESCRIPTION_CHARS) {
    return {
      ok: false,
      detail: `Description is ${text.length} characters, below the ${MIN_DESCRIPTION_CHARS} character floor`,
    };
  }

  const unique = uniqueTokenCount(text);
  if (unique < MIN_UNIQUE_TOKENS) {
    return {
      ok: false,
      detail: `Description has ${unique} unique words, below the ${MIN_UNIQUE_TOKENS} word floor`,
    };
  }

  return { ok: true };
}

/**
 * Canary for an upstream source silently changing shape. Under the Module 3
 * conditions, where 35 of 35 descriptions came back empty, this fires on the
 * very first run instead of being inferred later from suspicious scores.
 */
export function isDegraded(total: number, insufficient: number): boolean {
  if (total <= 0) return false;
  return insufficient / total > DEGRADED_RATIO;
}
