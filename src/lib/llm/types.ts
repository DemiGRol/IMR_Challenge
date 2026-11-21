export interface GenerateBpmnInput {
  processDescription: string;
}

export interface LlmRawBpmnOutput {
  bpmnXml: string;
  assumptions: string[];
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  generate(input: GenerateBpmnInput, signal: AbortSignal): Promise<LlmRawBpmnOutput>;
}

export interface LlmGenerateResult {
  bpmnXml: string;
  assumptions: string[];
  meta: {
    provider: string;
    model: string;
    latencyMs: number;
    fallbackUsed: boolean;
  };
}

export class LlmServiceError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 502) {
    super(message);
    this.name = 'LlmServiceError';
    this.statusCode = statusCode;
  }
}
