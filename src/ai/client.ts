export interface AiUsage {
  model: string;
  tokensIn: number;
  tokensOut: number;
}

export interface AiResult<T> {
  data: T;
  usage: AiUsage;
}

/**
 * The narrow shape of the Workers AI binding that this app actually uses.
 * The platform `Ai` type carries a large overload set keyed on model name,
 * which makes a test fake expensive to write and pointless to satisfy. The
 * one widening cast from `Ai` to `AiRunner` lives at the Workflow call site.
 */
export interface AiRunner {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export interface CallOptions {
  ai: AiRunner;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  /**
   * A JSON Schema, passed straight through. Workers AI has no strict mode,
   * so the schema is a request rather than a guarantee. Range and presence
   * checks belong to the caller.
   */
  schema?: object;
}

export async function callModel<T>(opts: CallOptions): Promise<AiResult<T>> {
  const input: Record<string, unknown> = {
    max_tokens: opts.maxTokens,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
  };

  if (opts.schema) {
    input.response_format = { type: 'json_schema', json_schema: opts.schema };
  }

  // Deliberately unguarded. Rate limits, quota exhaustion, and
  // "JSON Mode couldn't be met" all arrive as a rejection, and a rejection is
  // what makes the Workflow step retry. Catching here would convert a
  // retryable failure into a silent one.
  const raw = (await opts.ai.run(opts.model, input)) as {
    response?: unknown;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const usage: AiUsage = {
    model: opts.model,
    tokensIn: raw.usage?.prompt_tokens ?? 0,
    tokensOut: raw.usage?.completion_tokens ?? 0,
  };

  const content = raw.response;

  if (!opts.schema) {
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('Model response had no message content');
    }
    return { data: content as T, usage };
  }

  // In JSON mode Workers AI may hand back an already parsed object or the
  // JSON as a string, depending on model. Accept both rather than betting on
  // one and failing in production on the other.
  if (content !== null && typeof content === 'object') {
    return { data: content as T, usage };
  }
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('Model response had no message content');
  }
  try {
    return { data: JSON.parse(content) as T, usage };
  } catch {
    throw new Error('Model returned malformed JSON');
  }
}
