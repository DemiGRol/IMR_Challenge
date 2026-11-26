import type { TokenUsage } from '@/lib/telemetry';

export interface GenerateBpmnInput {
  processDescription: string;
  previousBpmnXml?: string;
  repairFeedback?: string;
  mode?: 'detailed' | 'fast';
}

export interface AnalyzeBpmnInput {
  processDescription?: string;
  currentBpmnXml: string;
  resolvedQuestions?: string[];
  mode?: 'detailed' | 'fast';
}

export type AssumptionImpact = 'high' | 'medium' | 'low';

export interface StructuredAssumption {
  question: string;
  assumption: string;
  impact?: AssumptionImpact;
  elementIds: string[];
  sourceExcerpt?: string;
}

export interface ModelingRecommendation {
  title: string;
  explanation: string;
  elementIds: string[];
}

export interface LlmRawBpmnOutput {
  bpmnXml: string;
  assumptions: StructuredAssumption[];
  recommendations?: ModelingRecommendation[];
  usage?: TokenUsage;
  finishReason?: string;
}

export interface LlmRawAnalyzeOutput {
  assumptions: StructuredAssumption[];
  recommendations: ModelingRecommendation[];
  usage?: TokenUsage;
  finishReason?: string;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  generate(input: GenerateBpmnInput, signal: AbortSignal): Promise<LlmRawBpmnOutput>;
  analyze?(input: AnalyzeBpmnInput, signal: AbortSignal): Promise<LlmRawAnalyzeOutput>;
}

export interface LlmGenerateResult {
  bpmnXml: string;
  assumptions: StructuredAssumption[];
  recommendations?: ModelingRecommendation[];
  usage?: TokenUsage;
  finishReason?: string;
  meta: {
    provider: string;
    model: string;
    latencyMs: number;
    fallbackUsed: boolean;
    attempts: number;
    repaired: boolean;
  };
}

export interface LlmAnalyzeResult {
  assumptions: StructuredAssumption[];
  recommendations: ModelingRecommendation[];
  usage?: TokenUsage;
  finishReason?: string;
  meta: {
    provider: string;
    model: string;
    latencyMs: number;
    fallbackUsed: boolean;
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
