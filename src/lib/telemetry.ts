export interface TokenUsage {
  promptTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
  totalTokens?: number;
}

export interface GenerationTelemetryEvent {
  event: 'bpmn_generation';
  timestamp: string;
  requestId: string;
  outcome: 'success' | 'error';
  httpStatus: number;
  errorCode: string | null;
  provider?: string;
  model?: string;
  fallbackUsed?: boolean;
  cached?: boolean;
  incremental?: boolean;
  latencyMs: number;
  attempts: number;
  repaired: boolean;
  inputChars: number;
  outputXmlBytes?: number;
  assumptionsCount?: number;
  usage?: TokenUsage;
  estimatedCostUsd?: number;
}

// Referencia estimada por 1M tokens (tier Flash/Hydrogen; solo métrica orientativa de admin)
const INPUT_USD_PER_1M = 0.3;
const OUTPUT_USD_PER_1M = 2.5;

function estimateCostUsd(usage?: TokenUsage): number | undefined {
  if (!usage) return undefined;
  const input = usage.promptTokens ?? 0;
  const output = (usage.outputTokens ?? 0) + (usage.thinkingTokens ?? 0);
  if (input === 0 && output === 0) return undefined;
  const usd = (input / 1_000_000) * INPUT_USD_PER_1M + (output / 1_000_000) * OUTPUT_USD_PER_1M;
  return Number(usd.toFixed(6));
}

export function logGenerationTelemetry(
  payload: Omit<GenerationTelemetryEvent, 'event' | 'timestamp' | 'estimatedCostUsd'>
): void {
  const record: GenerationTelemetryEvent = {
    event: 'bpmn_generation',
    timestamp: new Date().toISOString(),
    ...payload,
    estimatedCostUsd: estimateCostUsd(payload.usage),
  };
  console.info(JSON.stringify(record));
}
