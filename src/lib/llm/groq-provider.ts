import { z } from 'zod';
import { BPMN_SYSTEM_INSTRUCTION } from './prompt';
import { GenerateBpmnInput, LlmProvider, LlmRawBpmnOutput, LlmServiceError } from './types';

const AssumptionSchema = z.object({
  question: z.string().min(3),
  assumption: z.string().min(3),
  elementIds: z.array(z.string()).default([]),
  sourceExcerpt: z.string().optional().default(''),
});

const LlmOutputSchema = z.object({
  bpmnXml: z.string().min(20),
  assumptions: z.array(AssumptionSchema).default([]),
});

interface GroqChatResponse {
  choices?: Array<{
    finish_reason?: string;
    message?: { content?: string };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string };
}

export class GroqProvider implements LlmProvider {
  readonly name = 'groq';
  readonly model: string;
  private readonly apiKey: string;

  constructor() {
    const apiKey = process.env.GROQ_API_KEY?.trim();
    if (!apiKey) {
      throw new LlmServiceError(
        'Configuración de proveedor fallback Groq incompleta.',
        500,
        'GROQ_CONFIG_MISSING',
        false
      );
    }
    this.apiKey = apiKey;
    this.model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
  }

  async generate(input: GenerateBpmnInput, signal: AbortSignal): Promise<LlmRawBpmnOutput> {
    const userContent = input.repairFeedback
      ? `<process_description>\n${input.processDescription}\n</process_description>\n\nEl intento anterior falló la validación BPMN con este error:\n${input.repairFeedback}\n\nCorregí exclusivamente ese defecto y devolvé un JSON válido.`
      : `<process_description>\n${input.processDescription}\n</process_description>`;

    let res: Response;
    try {
      res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          max_tokens: 16384,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: BPMN_SYSTEM_INSTRUCTION },
            { role: 'user', content: userContent },
          ],
        }),
        signal,
      });
    } catch (err) {
      if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
        throw new LlmServiceError(
          'El proveedor fallback excedió el tiempo máximo de espera.',
          504,
          'GROQ_TIMEOUT',
          true
        );
      }
      throw new LlmServiceError(
        'Error de red al conectar con el proveedor fallback.',
        502,
        'GROQ_NETWORK_ERROR',
        true
      );
    }

    const data = (await res.json().catch(() => ({}))) as GroqChatResponse;
    if (!res.ok) {
      console.error('[GroqProvider] API error', {
        model: this.model,
        status: res.status,
        detail: (data.error?.message || '').slice(0, 200),
      });
      if (res.status === 429) {
        throw new LlmServiceError(
          'El proveedor fallback alcanzó su límite temporal de solicitudes.',
          429,
          'GROQ_RATE_LIMIT',
          true
        );
      }
      throw new LlmServiceError(
        'No se pudo obtener una respuesta válida del proveedor fallback.',
        502,
        'GROQ_API_ERROR',
        res.status >= 500
      );
    }

    const choice = data.choices?.[0];
    if (choice?.finish_reason === 'length') {
      throw new LlmServiceError(
        'El diagrama generado por el proveedor fallback se truncó por longitud.',
        502,
        'GROQ_MAX_TOKENS',
        false
      );
    }

    const text = choice?.message?.content?.trim();
    if (!text) {
      throw new LlmServiceError('El proveedor fallback devolvió una respuesta vacía.', 502, 'GROQ_EMPTY', true);
    }

    const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(cleaned);
    } catch {
      throw new LlmServiceError(
        'La respuesta del proveedor fallback no tuvo formato JSON válido.',
        502,
        'GROQ_INVALID_JSON',
        true
      );
    }

    const validated = LlmOutputSchema.safeParse(parsedJson);
    if (!validated.success) {
      throw new LlmServiceError(
        'La respuesta del proveedor fallback no cumplió el contrato esperado.',
        502,
        'GROQ_SCHEMA_MISMATCH',
        true
      );
    }

    return {
      ...validated.data,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            outputTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
    };
  }
}
