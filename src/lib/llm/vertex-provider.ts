import { GoogleGenAI, Type } from '@google/genai';
import { z } from 'zod';
import { BPMN_SYSTEM_INSTRUCTION } from './prompt';
import { GenerateBpmnInput, LlmProvider, LlmRawBpmnOutput, LlmServiceError } from './types';

const LlmOutputSchema = z.object({
  bpmnXml: z.string().min(20),
  assumptions: z.array(z.string()).default([]),
});

function parseServiceAccount(raw: string | undefined): Record<string, unknown> {
  if (!raw) {
    throw new LlmServiceError('Configuración de proveedor LLM incompleta en el servidor.', 500);
  }
  const trimmed = raw.trim();
  const jsonText = trimmed.startsWith('{')
    ? trimmed
    : Buffer.from(trimmed, 'base64').toString('utf8');
  try {
    return JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    throw new LlmServiceError('Credenciales de servicio GCP con formato inválido en el servidor.', 500);
  }
}

export class VertexAiProvider implements LlmProvider {
  readonly name = 'vertex-ai';
  readonly model: string;
  private readonly project: string;
  private readonly location: string;
  private readonly credentials: Record<string, unknown>;

  constructor() {
    const project = process.env.GCP_PROJECT_ID;
    if (!project) {
      throw new LlmServiceError('Configuración de proyecto GCP faltante en el servidor.', 500);
    }
    this.project = project;
    this.location = process.env.GCP_LOCATION || 'global';
    this.model = process.env.VERTEX_MODEL || 'gemini-4-hydrogen';
    this.credentials = parseServiceAccount(process.env.GCP_SERVICE_ACCOUNT_JSON);
  }

  async generate(input: GenerateBpmnInput, signal: AbortSignal): Promise<LlmRawBpmnOutput> {
    const ai = new GoogleGenAI({
      vertexai: true,
      project: this.project,
      location: this.location,
      googleAuthOptions: { credentials: this.credentials },
    });

    const response = await ai.models.generateContent({
      model: this.model,
      contents: `Descripción del proceso de negocio:\n\n${input.processDescription}`,
      config: {
        systemInstruction: BPMN_SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            bpmnXml: { type: Type.STRING },
            assumptions: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
          required: ['bpmnXml', 'assumptions'],
        },
        temperature: 0.2,
        abortSignal: signal,
      },
    });

    const text = response.text?.trim();
    if (!text) {
      throw new LlmServiceError('El modelo devolvió una respuesta vacía.', 502);
    }

    const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(cleaned);
    } catch {
      throw new LlmServiceError('La respuesta del modelo no tuvo formato JSON válido.', 502);
    }

    const validated = LlmOutputSchema.safeParse(parsedJson);
    if (!validated.success) {
      throw new LlmServiceError('La respuesta del modelo no cumplió el contrato esperado.', 502);
    }

    return validated.data;
  }
}
