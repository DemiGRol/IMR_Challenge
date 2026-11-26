import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { z } from 'zod';
import { BPMN_ANALYZE_INSTRUCTION, BPMN_SYSTEM_INSTRUCTION } from './prompt';
import {
  AnalyzeBpmnInput,
  GenerateBpmnInput,
  LlmProvider,
  LlmRawAnalyzeOutput,
  LlmRawBpmnOutput,
  LlmServiceError,
} from './types';

const AssumptionSchema = z.object({
  question: z.string().min(3),
  assumption: z.string().min(3),
  impact: z.enum(['high', 'medium', 'low']).default('medium'),
  elementIds: z.array(z.string()).default([]),
  sourceExcerpt: z.string().optional().default(''),
});

const RecommendationSchema = z.object({
  title: z.string().min(3),
  explanation: z.string().min(3),
  elementIds: z.array(z.string()).default([]),
});

const LlmOutputSchema = z.object({
  bpmnXml: z.string().min(20),
  assumptions: z.array(AssumptionSchema).default([]),
  recommendations: z.array(RecommendationSchema).default([]),
});

const AnalyzeOutputSchema = z.object({
  assumptions: z.array(AssumptionSchema).default([]),
  recommendations: z.array(RecommendationSchema).default([]),
});

let cachedStudioClient: GoogleGenAI | null = null;
let cachedStudioKey = '';

function escapeDelimiter(value: string, tag: string): string {
  return value.replace(new RegExp(`<\\s*/\\s*${tag}\\s*>`, 'gi'), `&lt;/${tag}&gt;`);
}

function redactSecrets(message: string): string {
  return message.replace(/AIza[A-Za-z0-9_-]{12,}/g, 'AIza***REDACTED***');
}

export class GoogleAiStudioProvider implements LlmProvider {
  readonly name = 'google-ai-studio';
  readonly model: string;
  private readonly client: GoogleGenAI;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      throw new LlmServiceError(
        'Configuración de Google AI Studio (GEMINI_API_KEY) faltante.',
        500,
        'STUDIO_CONFIG_MISSING',
        false
      );
    }
    this.model = process.env.GEMINI_STUDIO_MODEL || 'gemini-4-hydrogen';
    if (!cachedStudioClient || cachedStudioKey !== apiKey) {
      cachedStudioClient = new GoogleGenAI({ apiKey });
      cachedStudioKey = apiKey;
    }
    this.client = cachedStudioClient;
  }

  async generate(input: GenerateBpmnInput, signal: AbortSignal): Promise<LlmRawBpmnOutput> {
    const safeDesc = escapeDelimiter(input.processDescription, 'process_description');
    const previousSemantic = escapeDelimiter(
      input.previousBpmnXml?.trim() || '',
      'previous_bpmn_xml'
    );

    let userContent = `<process_description>\n${safeDesc}\n</process_description>`;
    if (previousSemantic) {
      userContent += `\n\n<previous_bpmn_xml>\n${previousSemantic}\n</previous_bpmn_xml>\nConservá los elementos y ediciones manuales presentes en <previous_bpmn_xml> salvo que contradigan <process_description>, aplicando solo los cambios solicitados.`;
    }
    if (input.repairFeedback) {
      userContent += `\n\nEl intento anterior falló la validación BPMN con este error:\n${input.repairFeedback}\n\nCorregí exclusivamente ese defecto y devolvé un JSON válido.`;
    }

    let response;
    try {
      response = await this.client.models.generateContent({
        model: this.model,
        contents: userContent,
        config: {
          systemInstruction: BPMN_SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              bpmnXml: { type: Type.STRING },
              assumptions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    question: { type: Type.STRING },
                    assumption: { type: Type.STRING },
                    impact: { type: Type.STRING, enum: ['high', 'medium', 'low'] },
                    elementIds: { type: Type.ARRAY, items: { type: Type.STRING } },
                    sourceExcerpt: { type: Type.STRING },
                  },
                  required: ['question', 'assumption', 'impact', 'elementIds', 'sourceExcerpt'],
                },
              },
              recommendations: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    explanation: { type: Type.STRING },
                    elementIds: { type: Type.ARRAY, items: { type: Type.STRING } },
                  },
                  required: ['title', 'explanation', 'elementIds'],
                },
              },
            },
            required: ['bpmnXml', 'assumptions', 'recommendations'],
          },
          temperature: 0.2,
          maxOutputTokens: 32768,
          thinkingConfig: {
            thinkingLevel: input.mode === 'fast' ? ThinkingLevel.LOW : ThinkingLevel.MEDIUM,
          },
          abortSignal: signal,
        },
      });
    } catch (err) {
      const rawDetail = err instanceof Error ? err.message : String(err);
      const detail = redactSecrets(rawDetail).slice(0, 220);
      const is429 = detail.includes('429') || detail.includes('RESOURCE_EXHAUSTED');
      console.error('[GoogleAiStudioProvider] SDK error', {
        model: this.model,
        is429,
        detail,
      });
      if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
        throw new LlmServiceError(
          'El proveedor fallback excedió el tiempo máximo de espera.',
          504,
          'STUDIO_TIMEOUT',
          true
        );
      }
      if (is429) {
        throw new LlmServiceError(
          'El proveedor fallback alcanzó su límite temporal de solicitudes.',
          429,
          'STUDIO_RATE_LIMIT',
          true
        );
      }
      throw new LlmServiceError(
        'No se pudo obtener una respuesta válida del proveedor fallback.',
        502,
        'STUDIO_API_ERROR',
        true
      );
    }

    const finishReason = response.candidates?.[0]?.finishReason;
    if (finishReason === 'MAX_TOKENS') {
      throw new LlmServiceError(
        'El diagrama generado se truncó por longitud. Probá resumir la descripción.',
        502,
        'STUDIO_MAX_TOKENS',
        false
      );
    }
    if (finishReason === 'SAFETY' || finishReason === 'RECITATION') {
      throw new LlmServiceError(
        'La descripción no pudo procesarse por políticas de seguridad del modelo.',
        400,
        'STUDIO_SAFETY_BLOCK',
        false
      );
    }

    const text = response.text?.trim();
    if (!text) {
      throw new LlmServiceError('El proveedor fallback devolvió una respuesta vacía.', 502, 'STUDIO_EMPTY', true);
    }

    const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(cleaned);
    } catch {
      throw new LlmServiceError('Respuesta JSON inválida del proveedor fallback.', 502, 'STUDIO_INVALID_JSON', true);
    }

    const validated = LlmOutputSchema.safeParse(parsedJson);
    if (!validated.success) {
      throw new LlmServiceError('La respuesta del proveedor fallback no cumplió el contrato.', 502, 'STUDIO_SCHEMA', true);
    }

    const usageMeta = response.usageMetadata as
      | {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          thoughtsTokenCount?: number;
          totalTokenCount?: number;
        }
      | undefined;

    return {
      ...validated.data,
      finishReason: finishReason ? String(finishReason) : undefined,
      usage: usageMeta
        ? {
            promptTokens: usageMeta.promptTokenCount,
            outputTokens: usageMeta.candidatesTokenCount,
            thinkingTokens: usageMeta.thoughtsTokenCount,
            totalTokens: usageMeta.totalTokenCount,
          }
        : undefined,
    };
  }

  async analyze(input: AnalyzeBpmnInput, signal: AbortSignal): Promise<LlmRawAnalyzeOutput> {
    const safeXml = escapeDelimiter(input.currentBpmnXml.trim(), 'current_bpmn_xml');
    let userContent = `<current_bpmn_xml>\n${safeXml}\n</current_bpmn_xml>`;
    if (input.processDescription?.trim()) {
      const safeDesc = escapeDelimiter(input.processDescription.trim(), 'process_description');
      userContent += `\n\n<process_description>\n${safeDesc}\n</process_description>`;
    }
    if (input.resolvedQuestions && input.resolvedQuestions.length > 0) {
      const listText = input.resolvedQuestions
        .map((q) => `- ${escapeDelimiter(q, 'resolved_questions')}`)
        .join('\n');
      userContent += `\n\n<resolved_questions>\n${listText}\n</resolved_questions>`;
    }

    let response;
    try {
      response = await this.client.models.generateContent({
        model: this.model,
        contents: userContent,
        config: {
          systemInstruction: BPMN_ANALYZE_INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              assumptions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    question: { type: Type.STRING },
                    assumption: { type: Type.STRING },
                    impact: { type: Type.STRING, enum: ['high', 'medium', 'low'] },
                    elementIds: { type: Type.ARRAY, items: { type: Type.STRING } },
                    sourceExcerpt: { type: Type.STRING },
                  },
                  required: ['question', 'assumption', 'impact', 'elementIds', 'sourceExcerpt'],
                },
              },
              recommendations: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    explanation: { type: Type.STRING },
                    elementIds: { type: Type.ARRAY, items: { type: Type.STRING } },
                  },
                  required: ['title', 'explanation', 'elementIds'],
                },
              },
            },
            required: ['assumptions', 'recommendations'],
          },
          temperature: 0.2,
          maxOutputTokens: 8192,
          thinkingConfig: {
            thinkingLevel: input.mode === 'fast' ? ThinkingLevel.LOW : ThinkingLevel.MEDIUM,
          },
          abortSignal: signal,
        },
      });
    } catch (err) {
      const rawDetail = err instanceof Error ? err.message : String(err);
      const detail = redactSecrets(rawDetail).slice(0, 180);
      console.error('[GoogleAiStudioProvider] analyze SDK error', { model: this.model, detail });
      if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
        throw new LlmServiceError('El análisis excedió el tiempo máximo de espera.', 504, 'STUDIO_TIMEOUT', true);
      }
      throw new LlmServiceError('No se pudo analizar el diagrama en el proveedor fallback.', 502, 'STUDIO_API_ERROR', true);
    }

    const finishReason = response.candidates?.[0]?.finishReason;
    if (finishReason === 'MAX_TOKENS') {
      throw new LlmServiceError(
        'El análisis superó el límite de respuesta del proveedor fallback.',
        502,
        'STUDIO_MAX_TOKENS',
        false
      );
    }
    if (finishReason === 'SAFETY' || finishReason === 'RECITATION') {
      throw new LlmServiceError(
        'El análisis no pudo procesarse por políticas de seguridad del modelo.',
        400,
        'STUDIO_SAFETY_BLOCK',
        false
      );
    }
    const text = response.text?.trim();
    if (!text) {
      throw new LlmServiceError('El proveedor fallback devolvió una respuesta vacía al analizar.', 502, 'STUDIO_EMPTY', true);
    }

    const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(cleaned);
    } catch {
      throw new LlmServiceError('Respuesta JSON inválida en el análisis fallback.', 502, 'STUDIO_INVALID_JSON', true);
    }

    const validated = AnalyzeOutputSchema.safeParse(parsedJson);
    if (!validated.success) {
      throw new LlmServiceError('La respuesta de análisis fallback no cumplió el contrato.', 502, 'STUDIO_SCHEMA', true);
    }

    const usageMeta = response.usageMetadata as
      | {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          thoughtsTokenCount?: number;
          totalTokenCount?: number;
        }
      | undefined;

    return {
      ...validated.data,
      finishReason: finishReason ? String(finishReason) : undefined,
      usage: usageMeta
        ? {
            promptTokens: usageMeta.promptTokenCount,
            outputTokens: usageMeta.candidatesTokenCount,
            thinkingTokens: usageMeta.thoughtsTokenCount,
            totalTokens: usageMeta.totalTokenCount,
          }
        : undefined,
    };
  }
}
