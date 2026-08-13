import { describe, expect, it, vi } from 'vitest';
import type { AiRunner } from '../../src/ai/client';
import { scoreJob } from '../../src/ai/score';

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/** Records every call so a test can assert on what was actually sent. */
function stubAi(
  response: unknown,
  usage = { prompt_tokens: 2000, completion_tokens: 100 },
) {
  const run = vi.fn(async () => ({ response, usage }));
  return { ai: { run } as unknown as AiRunner, run };
}

const job = {
  title: 'Backend Engineer',
  company: 'Acme',
  description: 'Build payment services in Go on Kubernetes.',
};

const valid = {
  score: 82,
  reason: 'Strong overlap on Go and Kubernetes.',
  evidence: [
    { jdQuote: 'services in Go', resumeQuote: 'rewriting the pricing service in Go' },
  ],
};

describe('scoreJob', () => {
  it('returns the parsed score and reports token usage', async () => {
    const { ai } = stubAi(valid);
    const result = await scoreJob({ ai, model: MODEL, resume: 'resume text', job });

    expect(result.data).toEqual(valid);
    expect(result.usage).toEqual({ model: MODEL, tokensIn: 2000, tokensOut: 100 });
  });

  it('accepts JSON handed back as a string, not only as an object', async () => {
    // Workers AI is not consistent across models about which it returns.
    const { ai } = stubAi(JSON.stringify(valid));
    const result = await scoreJob({ ai, model: MODEL, resume: 'r', job });

    expect(result.data).toEqual(valid);
  });

  it('truncates a very long description before sending it', async () => {
    const { ai, run } = stubAi(valid);
    await scoreJob({
      ai,
      model: MODEL,
      resume: 'resume text',
      job: { ...job, description: 'x'.repeat(20_000) },
    });

    const calls = run.mock.calls as unknown as Array<[string, Record<string, unknown>]>;
    const call = calls[0];
    expect(call).toBeDefined();
    const input = call![1] as {
      messages: Array<{ content: string }>;
    };
    const userMessage = input.messages[1];
    expect(userMessage).toBeDefined();
    expect(userMessage!.content.length).toBeLessThan(8000);
  });

  it('throws on malformed JSON so the workflow step retries', async () => {
    const { ai } = stubAi('not json');
    await expect(scoreJob({ ai, model: MODEL, resume: 'r', job })).rejects.toThrow(
      /malformed JSON/,
    );
  });

  it('lets a provider rejection propagate rather than swallowing it', async () => {
    // Quota exhaustion and "JSON Mode couldn't be met" both arrive this way.
    // Nothing may convert them into a usable-looking result.
    const ai = {
      run: vi.fn(async () => {
        throw new Error('JSON Mode couldn\'t be met');
      }),
    } as unknown as AiRunner;

    await expect(scoreJob({ ai, model: MODEL, resume: 'r', job })).rejects.toThrow(
      /JSON Mode/,
    );
  });

  it('rejects an out of range score instead of storing it', async () => {
    const { ai } = stubAi({ ...valid, score: 140 });
    await expect(scoreJob({ ai, model: MODEL, resume: 'r', job })).rejects.toThrow(
      /out of range/,
    );
  });

  // The output contract from the spec: a score without evidence is invalid,
  // not merely low quality. Workers AI has no strict mode, so this check is
  // the only thing enforcing that contract.
  it('rejects a score that arrives with no evidence', async () => {
    const { ai } = stubAi({ ...valid, evidence: [] });
    await expect(scoreJob({ ai, model: MODEL, resume: 'r', job })).rejects.toThrow(
      /no evidence/,
    );
  });

  it('rejects an empty reason', async () => {
    const { ai } = stubAi({ ...valid, reason: '   ' });
    await expect(scoreJob({ ai, model: MODEL, resume: 'r', job })).rejects.toThrow(
      /no reason/,
    );
  });
});
