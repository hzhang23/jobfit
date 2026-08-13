import { describe, expect, it, vi } from 'vitest';
import type { AiRunner } from '../../src/ai/client';
import { tailorResume } from '../../src/ai/tailor';

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

function stubText(text: string) {
  const run = vi.fn(async () => ({
    response: text,
    usage: { prompt_tokens: 4000, completion_tokens: 1200 },
  }));
  return { ai: { run } as unknown as AiRunner, run };
}

const job = {
  title: 'Backend Engineer',
  company: 'Acme',
  description: 'Go and Kubernetes.',
};

describe('tailorResume', () => {
  it('returns the rewritten resume text and usage', async () => {
    const { ai } = stubText('Rewritten resume');
    const result = await tailorResume({ ai, model: MODEL, resume: 'master resume', job });

    expect(result.data).toBe('Rewritten resume');
    expect(result.usage.tokensOut).toBe(1200);
  });

  it('sends a system prompt that forbids inventing facts', async () => {
    const { ai, run } = stubText('ok');
    await tailorResume({ ai, model: MODEL, resume: 'r', job });

    const calls = run.mock.calls as unknown as Array<[string, Record<string, unknown>]>;
    const call = calls[0];
    expect(call).toBeDefined();
    const input = call![1] as { messages: Array<{ content: string }> };
    const systemMessage = input.messages[0];
    expect(systemMessage).toBeDefined();
    expect(systemMessage!.content).toMatch(/never invent/i);
  });

  it('throws when the model returns nothing', async () => {
    const { ai } = stubText('   ');
    await expect(tailorResume({ ai, model: MODEL, resume: 'r', job })).rejects.toThrow(
      /no message content/,
    );
  });
});
