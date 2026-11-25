import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { z } from 'zod';
import { BPMN_SYSTEM_INSTRUCTION } from './prompt';
import { GenerateBpmnInput, LlmProvider, LlmRawBpmnOutput, LlmServiceError } from './types';

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

function parseServiceAccount(raw: string | undefined): Record<string, unknown> {
  if (!raw) {
    throw new LlmServiceError(
      'Configuración de proveedor LLM incompleta en el servidor.',
      500,
      'CONFIG_MISSING',
      false
    );
  }
  const trimmed = raw.trim();
  const jsonText = trimmed.startsWith('{')
    ? trimmed
    : Buffer.from(trimmed, 'base64').toString('utf8');
  try {
    return JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    throw new LlmServiceError(
      'Credenciales de servicio GCP con formato inválido en el servidor.',
      500,
      'CONFIG_INVALID',
      false
    );
  }
}

function classifySdkError(err: unknown): LlmServiceError {
  if (err instanceof LlmServiceError) return err;
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
    return new LlmServiceError(
      'La generación excedió el tiempo máximo de espera. Intentá nuevamente.',
      504,
      'TIMEOUT',
      true
    );
  }

  const rawMessage = err instanceof Error ? err.message : '';
  const status =
    typeof err === 'object' && err !== null && 'status' in err
      ? Number((err as { status?: unknown }).status)
      : rawMessage.includes('"code":429') || rawMessage.includes('RESOURCE_EXHAUSTED')
        ? 429
        : undefined;

  if (status === 429) {
    return new LlmServiceError(
      'El servicio de IA alcanzó temporalmente su límite de solicitudes. Intentá en unos segundos.',
      429,
      'PROVIDER_RATE_LIMIT',
      true
    );
  }
  if (status === 401 || status === 403) {
    return new LlmServiceError(
      'Error de autenticación con el proveedor LLM en el servidor.',
      502,
      'PROVIDER_AUTH_ERROR',
      false
    );
  }
  if (status === 404) {
    return new LlmServiceError(
      'El modelo LLM configurado no está disponible en la región del servidor.',
      502,
      'MODEL_NOT_FOUND',
      false
    );
  }
  if (status === 500 || status === 503) {
    return new LlmServiceError(
      'El proveedor LLM no está disponible temporalmente. Intentá nuevamente.',
      503,
      'PROVIDER_UNAVAILABLE',
      true
    );
  }

  return new LlmServiceError(
    'No se pudo obtener una respuesta válida del proveedor LLM. Intentá nuevamente.',
    502,
    'PROVIDER_ERROR',
    true
  );
}

let cachedClient: GoogleGenAI | null = null;
let cachedConfigKey = '';

export class VertexAiProvider implements LlmProvider {
  readonly name = 'vertex-ai';
  readonly model: string;
  private readonly project: string;
  private readonly location: string;
  private readonly client: GoogleGenAI;

  constructor() {
    const project = process.env.GCP_PROJECT_ID;
    if (!project) {
      throw new LlmServiceError(
        'Configuración de proyecto GCP faltante en el servidor.',
        500,
        'CONFIG_MISSING',
        false
      );
    }
    this.project = project;
    this.location = process.env.GCP_LOCATION || 'global';
    this.model = process.env.VERTEX_MODEL || 'gemini-4-hydrogen';

    const configKey = `${this.project}:${this.location}:${this.model}`;
    if (!cachedClient || cachedConfigKey !== configKey) {
      const credentials = parseServiceAccount(process.env.GCP_SERVICE_ACCOUNT_JSON);
      cachedClient = new GoogleGenAI({
        vertexai: true,
        project: this.project,
        location: this.location,
        googleAuthOptions: { credentials },
      });
      cachedConfigKey = configKey;
    }
    this.client = cachedClient;
  }

  async generate(input: GenerateBpmnInput, signal: AbortSignal): Promise<LlmRawBpmnOutput> {
    const previousSemantic = input.previousBpmnXml?.trim() || '';

    let userContent = `<process_description>\n${input.processDescription}\n</process_description>`;
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
                    elementIds: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
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
                    elementIds: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
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
      const classified = classifySdkError(err);
      const safeDetail =
        err instanceof Error ? err.message.slice(0, 260) : String(err).slice(0, 260);
      console.error('[VertexAiProvider] SDK error', {
        model: this.model,
        location: this.location,
        code: classified.code,
        statusCode: classified.statusCode,
        detail: safeDetail,
      });
      throw classified;
    }

    const finishReason = response.candidates?.[0]?.finishReason;
    if (finishReason === 'MAX_TOKENS') {
      throw new LlmServiceError(
        'El diagrama generado fue demasiado extenso y se truncó. Probá resumir la descripción.',
        502,
        'MAX_TOKENS',
        false
      );
    }
    if (finishReason === 'SAFETY' || finishReason === 'RECITATION') {
      throw new LlmServiceError(
        'La descripción no pudo procesarse por políticas de seguridad del modelo.',
        400,
        'SAFETY_BLOCK',
        false
      );
    }

    const text = response.text?.trim();
    if (!text) {
      throw new LlmServiceError('El modelo devolvió una respuesta vacía.', 502, 'EMPTY_RESPONSE', true);
    }

    const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(cleaned);
    } catch {
      throw new LlmServiceError(
        'La respuesta del modelo no tuvo formato JSON válido.',
        502,
        'INVALID_JSON',
        true
      );
    }

    const validated = LlmOutputSchema.safeParse(parsedJson);
    if (!validated.success) {
      throw new LlmServiceError(
        'La respuesta del modelo no cumplió el contrato esperado.',
        502,
        'SCHEMA_MISMATCH',
        true
      );
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
