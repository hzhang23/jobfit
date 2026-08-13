import { type AiResult, type AiRunner, callModel } from './client';
import { MAX_DESCRIPTION_CHARS } from './score';

/**
 * This prompt is a mitigation, not a guarantee. The guarantee is the
 * provenance validator that runs over whatever comes back. That separation
 * matters more with an open weights model than it did with a frontier one:
 * the prompt is likely to be followed less reliably, and the validator does
 * not care how reliable the prompt was.
 */
const SYSTEM = [
  'You rewrite a candidate resume so it speaks directly to one job description.',
  'You may reorder, reword, re-emphasize, and cut.',
  'You must never invent an employer, a job title, a date, a metric, a technology, or a credential.',
  'Every fact in your output must already appear in the resume you were given.',
  'If the resume lacks something the job asks for, leave it out rather than filling the gap.',
  'Return plain text only. No preamble, no markdown fences, no commentary.',
].join(' ');

export async function tailorResume(opts: {
  ai: AiRunner;
  model: string;
  resume: string;
  job: { title: string; company: string; description: string };
}): Promise<AiResult<string>> {
  const user = [
    `TARGET ROLE: ${opts.job.title} at ${opts.job.company}`,
    '',
    'JOB DESCRIPTION:',
    opts.job.description.slice(0, MAX_DESCRIPTION_CHARS),
    '',
    'MASTER RESUME:',
    opts.resume,
  ].join('\n');

  return callModel<string>({
    ai: opts.ai,
    model: opts.model,
    system: SYSTEM,
    user,
    maxTokens: 2000,
  });
}
