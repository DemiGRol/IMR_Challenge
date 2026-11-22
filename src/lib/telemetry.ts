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
  latencyMs: number;
  attempts: number;
  repaired: boolean;
  inputChars: number;
  outputXmlBytes?: number;
  assumptionsCount?: number;
  usage?: TokenUsage;
}

export function logGenerationTelemetry(payload: Omit<GenerationTelemetryEvent, 'event' | 'timestamp'>): void {
  const record: GenerationTelemetryEvent = {
    event: 'bpmn_generation',
    timestamp: new Date().toISOString(),
    ...payload,
  };
  console.info(JSON.stringify(record));
}
