export interface GenerateBpmnInput {
  processDescription: string;
  repairFeedback?: string;
}

export interface StructuredAssumption {
  question: string;
  assumption: string;
}

export interface LlmRawBpmnOutput {
  bpmnXml: string;
  assumptions: StructuredAssumption[];
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  generate(input: GenerateBpmnInput, signal: AbortSignal): Promise<LlmRawBpmnOutput>;
}

export interface LlmGenerateResult {
  bpmnXml: string;
  assumptions: StructuredAssumption[];
  meta: {
    provider: string;
    model: string;
    latencyMs: number;
    fallbackUsed: boolean;
    attempts: number;
    repaired: boolean;
  };
}

export class LlmServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, statusCode = 502, code = 'LLM_ERROR', retryable = false) {
    super(message);
    this.name = 'LlmServiceError';
    this.statusCode = statusCode;
    this.code = code;
    this.retryable = retryable;
  }
}
