export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

/** USD per million tokens. Update alongside any model change. */
export const PRICING: Record<string, ModelPricing> = {
  'gpt-4o-mini': { inputPerMTok: 0.15, outputPerMTok: 0.6 },
  'gpt-4o': { inputPerMTok: 2.5, outputPerMTok: 10.0 },
};

export function estimateCost(
  model: string,
  tokensIn: number,
  tokensOut: number,
): number {
  const pricing = PRICING[model];
  if (!pricing) {
    throw new Error(`No pricing configured for model ${model}`);
  }
  return (
    (tokensIn / 1_000_000) * pricing.inputPerMTok +
    (tokensOut / 1_000_000) * pricing.outputPerMTok
  );
}
