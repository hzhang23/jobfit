import type { EvidenceItem } from '../domain/types';
import { type AiResult, type AiRunner, callModel } from './client';

export const MAX_DESCRIPTION_CHARS = 6000;

export interface ScoreResult {
  score: number;
  reason: string;
  evidence: EvidenceItem[];
}

/**
 * Passed straight through to Workers AI as `response_format.json_schema`.
 * There is no strict mode, so this constrains the model's intent, not its
 * output. The validation below is what actually enforces the contract.
 */
export const SCORE_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'integer' },
    reason: { type: 'string' },
    evidence: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          jdQuote: { type: 'string' },
          resumeQuote: { type: 'string' },
        },
        required: ['jdQuote', 'resumeQuote'],
      },
    },
  },
  required: ['score', 'reason', 'evidence'],
} as const;

const SYSTEM = [
  'You judge how well a candidate resume fits a job description.',
  'Return a fit score from 0 to 100, one sentence explaining it, and at least one piece of evidence.',
  'Each evidence item pairs a short quote from the job description with a short quote from the resume.',
  'Quote both sides verbatim. Do not paraphrase inside a quote.',
  'Score on demonstrated overlap only. Do not reward enthusiasm or potential.',
].join(' ');

export async function scoreJob(opts: {
  ai: AiRunner;
  model: string;
  resume: string;
  job: { title: string; company: string; description: string };
}): Promise<AiResult<ScoreResult>> {
  const description = opts.job.description.slice(0, MAX_DESCRIPTION_CHARS);

  const user = [
    `JOB TITLE: ${opts.job.title}`,
    `COMPANY: ${opts.job.company}`,
    '',
    'JOB DESCRIPTION:',
    description,
    '',
    'CANDIDATE RESUME:',
    opts.resume,
  ].join('\n');

  const result = await callModel<ScoreResult>({
    ai: opts.ai,
    model: opts.model,
    system: SYSTEM,
    user,
    maxTokens: 800,
    schema: SCORE_SCHEMA,
  });

  const { score, reason, evidence } = result.data ?? {};

  if (!Number.isInteger(score) || score < 0 || score > 100) {
    throw new Error(`Model returned an out of range score: ${String(score)}`);
  }
  if (typeof reason !== 'string' || !reason.trim()) {
    throw new Error('Model returned a score with no reason');
  }
  if (!Array.isArray(evidence) || evidence.length === 0) {
    throw new Error('Model returned a score with no evidence');
  }

  return result;
}
