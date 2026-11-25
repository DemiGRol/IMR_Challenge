export interface TokenUsage {
  promptTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
  totalTokens?: number;
}

export interface ValidationTelemetry {
  passed: boolean;
  elementCount?: number;
  gatewayCount?: number;
  flowCount?: number;
  initialError?: string;
}

export interface GenerationTelemetryEvent {
  event: 'bpmn_generation';
  timestamp: string;
  requestId: string;
  outcome: 'success' | 'error';
  httpStatus: number;
  errorCode: string | null;
  mode?: 'detailed' | 'fast';
  provider?: string;
  model?: string;
  location?: string;
  finishReason?: string;
  fallbackUsed?: boolean;
  cached?: boolean;
  incremental?: boolean;
  latencyMs: number;
  attempts: number;
  repaired: boolean;
  inputChars: number;
  outputXmlBytes?: number;
  assumptionsCount?: number;
  validation?: ValidationTelemetry;
  usage?: TokenUsage;
  estimatedCostUsd?: number;
}

interface ModelPricingTier {
  input: number;
  output: number;
}

const MODEL_PRICING_PER_1M: Array<{
  prefix: string;
  global: ModelPricingTier;
  regional: ModelPricingTier;
}> = [
  {
    prefix: 'gemini-4-hydrogen',
    global: { input: 1.5, output: 7.5 },
    regional: { input: 1.65, output: 8.25 },
  },
  {
    prefix: 'gemini-4-neon',
    global: { input: 3.0, output: 15.0 },
    regional: { input: 3.3, output: 16.5 },
  },
  {
    prefix: 'gemini-2.5-pro',
    global: { input: 1.25, output: 10.0 },
    regional: { input: 1.25, output: 10.0 },
  },
  {
    prefix: 'gemini-2.5-flash',
    global: { input: 0.3, output: 2.5 },
    regional: { input: 0.3, output: 2.5 },
  },
];

export function estimateCostUsd(
  usage?: TokenUsage,
  model?: string,
  location = 'global'
): number | undefined {
  if (!usage || !model) return undefined;
  const normalizedModel = model.toLowerCase();
  const pricingEntry = MODEL_PRICING_PER_1M.find((entry) =>
    normalizedModel.startsWith(entry.prefix)
  );
  if (!pricingEntry) return undefined;

  const tier =
    location.toLowerCase() === 'global' ? pricingEntry.global : pricingEntry.regional;
  const input = usage.promptTokens ?? 0;
  const output = (usage.outputTokens ?? 0) + (usage.thinkingTokens ?? 0);
  if (input === 0 && output === 0) return undefined;

  const usd = (input / 1_000_000) * tier.input + (output / 1_000_000) * tier.output;
  return Number(usd.toFixed(6));
}

export function logGenerationTelemetry(
  payload: Omit<GenerationTelemetryEvent, 'event' | 'timestamp' | 'estimatedCostUsd'>
): void {
  const effectiveLocation = payload.location ?? (process.env.GCP_LOCATION || 'global');
  const record: GenerationTelemetryEvent = {
    event: 'bpmn_generation',
    timestamp: new Date().toISOString(),
    ...payload,
    estimatedCostUsd: estimateCostUsd(payload.usage, payload.model, effectiveLocation),
  };
  console.info(JSON.stringify(record));
}
