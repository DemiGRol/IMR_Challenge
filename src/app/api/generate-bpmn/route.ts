import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { BpmnValidationError, validateAndLayoutBpmn } from '@/lib/bpmn/validator';
import { ResilientLlmAdapter } from '@/lib/llm/adapter';
import { LlmServiceError } from '@/lib/llm/types';
import { VertexAiProvider } from '@/lib/llm/vertex-provider';
import { checkRateLimit } from '@/lib/rate-limit';

export const maxDuration = 300;

const TOTAL_BUDGET_MS = 240_000;
const MIN_REPAIR_BUDGET_MS = 30_000;

const RequestSchema = z.object({
  processDescription: z
    .string()
    .trim()
    .min(10, 'La descripción debe tener al menos 10 caracteres.')
    .max(4000, 'La descripción no puede superar los 4.000 caracteres.'),
});

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'local';
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Demasiadas solicitudes. Esperá unos segundos antes de volver a intentar.' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'El cuerpo de la solicitud debe ser JSON válido.' },
      { status: 400 }
    );
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message || 'Descripción de proceso inválida.';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const startedAt = performance.now();

  try {
    const adapter = new ResilientLlmAdapter([new VertexAiProvider()], 180_000);
    let result = await adapter.generate({
      processDescription: parsed.data.processDescription,
    });

    let layoutedXml: string;
    let attempts = 1;
    let repaired = false;

    try {
      layoutedXml = await validateAndLayoutBpmn(result.bpmnXml);
    } catch (validationErr) {
      if (!(validationErr instanceof BpmnValidationError)) throw validationErr;

      const remainingMs = TOTAL_BUDGET_MS - (performance.now() - startedAt);
      if (remainingMs < MIN_REPAIR_BUDGET_MS) {
        throw validationErr;
      }

      console.warn('[generate-bpmn] Validation failed, attempting single repair', {
        reason: validationErr.message,
        remainingMs: Math.round(remainingMs),
      });

      attempts = 2;
      repaired = true;
      result = await adapter.generate(
        {
          processDescription: parsed.data.processDescription,
          repairFeedback: validationErr.message,
        },
        Math.round(remainingMs)
      );
      layoutedXml = await validateAndLayoutBpmn(result.bpmnXml);
    }

    return NextResponse.json({
      bpmnXml: layoutedXml,
      assumptions: result.assumptions,
      meta: {
        ...result.meta,
        latencyMs: Math.round(performance.now() - startedAt),
        attempts,
        repaired,
      },
    });
  } catch (err) {
    if (err instanceof BpmnValidationError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    if (err instanceof LlmServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    console.error('[generate-bpmn] Unexpected error', {
      name: err instanceof Error ? err.name : 'UnknownError',
    });
    return NextResponse.json(
      { error: 'Ocurrió un error inesperado al generar el diagrama.' },
      { status: 500 }
    );
  }
}
