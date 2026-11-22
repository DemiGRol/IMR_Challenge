import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { BpmnValidationError, validateAndLayoutBpmn } from '@/lib/bpmn/validator';
import { buildCacheKey, getCachedBpmn, setCachedBpmn } from '@/lib/cache';
import { ResilientLlmAdapter } from '@/lib/llm/adapter';
import { GroqProvider } from '@/lib/llm/groq-provider';
import { LlmProvider, LlmServiceError } from '@/lib/llm/types';
import { VertexAiProvider } from '@/lib/llm/vertex-provider';
import { checkRateLimit } from '@/lib/rate-limit';
import { logGenerationTelemetry } from '@/lib/telemetry';

export const maxDuration = 300;

const TOTAL_BUDGET_MS = 240_000;
const MIN_REPAIR_BUDGET_MS = 30_000;

const RequestSchema = z.object({
  processDescription: z
    .string()
    .trim()
    .min(10, 'La descripción debe tener al menos 10 caracteres.')
    .max(4000, 'La descripción no puede superar los 4.000 caracteres.'),
  previousBpmnXml: z.string().max(150_000).optional(),
  mode: z.enum(['detailed', 'fast']).default('detailed'),
});

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'local';
}

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const startedAt = performance.now();
  const ip = getClientIp(req);
  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logGenerationTelemetry({
      requestId,
      outcome: 'error',
      httpStatus: 429,
      errorCode: 'APP_RATE_LIMIT',
      latencyMs: Math.round(performance.now() - startedAt),
      attempts: 0,
      repaired: false,
      inputChars: 0,
    });
    return NextResponse.json(
      { error: 'Demasiadas solicitudes. Esperá unos segundos antes de volver a intentar.', requestId },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec), 'X-Request-Id': requestId } }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    logGenerationTelemetry({
      requestId,
      outcome: 'error',
      httpStatus: 400,
      errorCode: 'INVALID_JSON_BODY',
      latencyMs: Math.round(performance.now() - startedAt),
      attempts: 0,
      repaired: false,
      inputChars: 0,
    });
    return NextResponse.json(
      { error: 'El cuerpo de la solicitud debe ser JSON válido.' },
      { status: 400 }
    );
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message || 'Descripción de proceso inválida.';
    logGenerationTelemetry({
      requestId,
      outcome: 'error',
      httpStatus: 400,
      errorCode: 'INVALID_INPUT',
      latencyMs: Math.round(performance.now() - startedAt),
      attempts: 0,
      repaired: false,
      inputChars: 0,
    });
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const inputChars = parsed.data.processDescription.length;
  const mode = parsed.data.mode;
  const cacheKey = buildCacheKey(parsed.data.processDescription, mode);
  const cachedEntry = getCachedBpmn(cacheKey);
  if (cachedEntry) {
    const totalLatencyMs = Math.round(performance.now() - startedAt);
    logGenerationTelemetry({
      requestId,
      outcome: 'success',
      httpStatus: 200,
      errorCode: null,
      provider: cachedEntry.provider,
      model: cachedEntry.model,
      fallbackUsed: false,
      cached: true,
      incremental: false,
      latencyMs: totalLatencyMs,
      attempts: 0,
      repaired: false,
      inputChars,
      outputXmlBytes: Buffer.byteLength(cachedEntry.bpmnXml, 'utf8'),
      assumptionsCount: cachedEntry.assumptions.length,
    });
    return NextResponse.json(
      {
        bpmnXml: cachedEntry.bpmnXml,
        assumptions: cachedEntry.assumptions,
        meta: {
          provider: cachedEntry.provider,
          model: cachedEntry.model,
          latencyMs: totalLatencyMs,
          attempts: 0,
          repaired: false,
          fallbackUsed: false,
          cached: true,
          incremental: false,
        },
      },
      { headers: { 'X-Request-Id': requestId } }
    );
  }

  const incremental = Boolean(parsed.data.previousBpmnXml?.trim());
  let attempts = 1;
  let repaired = false;

  try {
    const hasGroq = Boolean(process.env.GROQ_API_KEY?.trim());
    const providers: LlmProvider[] =
      mode === 'fast' && hasGroq
        ? [new GroqProvider(), new VertexAiProvider()]
        : hasGroq
          ? [new VertexAiProvider(), new GroqProvider()]
          : [new VertexAiProvider()];
    const adapter = new ResilientLlmAdapter(providers, 180_000);
    let result = await adapter.generate({
      processDescription: parsed.data.processDescription,
      previousBpmnXml: parsed.data.previousBpmnXml,
    });

    let layoutedXml: string;

    try {
      layoutedXml = await validateAndLayoutBpmn(result.bpmnXml);
    } catch (validationErr) {
      if (!(validationErr instanceof BpmnValidationError)) throw validationErr;

      const remainingMs = TOTAL_BUDGET_MS - (performance.now() - startedAt);
      if (remainingMs < MIN_REPAIR_BUDGET_MS) {
        throw validationErr;
      }

      attempts = 2;
      repaired = true;
      result = await adapter.generate(
        {
          processDescription: parsed.data.processDescription,
          previousBpmnXml: parsed.data.previousBpmnXml,
          repairFeedback: validationErr.message,
        },
        Math.round(remainingMs)
      );
      layoutedXml = await validateAndLayoutBpmn(result.bpmnXml);
    }

    setCachedBpmn(cacheKey, {
      bpmnXml: layoutedXml,
      assumptions: result.assumptions,
      provider: result.meta.provider,
      model: result.meta.model,
    });

    const totalLatencyMs = Math.round(performance.now() - startedAt);
    logGenerationTelemetry({
      requestId,
      outcome: 'success',
      httpStatus: 200,
      errorCode: null,
      provider: result.meta.provider,
      model: result.meta.model,
      fallbackUsed: result.meta.fallbackUsed,
      cached: false,
      incremental,
      latencyMs: totalLatencyMs,
      attempts,
      repaired,
      inputChars,
      outputXmlBytes: Buffer.byteLength(layoutedXml, 'utf8'),
      assumptionsCount: result.assumptions.length,
      usage: result.usage,
    });

    return NextResponse.json(
      {
        bpmnXml: layoutedXml,
        assumptions: result.assumptions,
        meta: {
          ...result.meta,
          latencyMs: totalLatencyMs,
          attempts,
          repaired,
          cached: false,
          incremental,
        },
      },
      { headers: { 'X-Request-Id': requestId } }
    );
  } catch (err) {
    const totalLatencyMs = Math.round(performance.now() - startedAt);
    if (err instanceof BpmnValidationError) {
      logGenerationTelemetry({
        requestId,
        outcome: 'error',
        httpStatus: 502,
        errorCode: 'BPMN_VALIDATION_ERROR',
        latencyMs: totalLatencyMs,
        attempts,
        repaired,
        inputChars,
      });
      return NextResponse.json(
        { error: err.message, requestId },
        { status: 502, headers: { 'X-Request-Id': requestId } }
      );
    }
    if (err instanceof LlmServiceError) {
      logGenerationTelemetry({
        requestId,
        outcome: 'error',
        httpStatus: err.statusCode,
        errorCode: err.code,
        latencyMs: totalLatencyMs,
        attempts,
        repaired,
        inputChars,
      });
      return NextResponse.json(
        { error: err.message, requestId },
        { status: err.statusCode, headers: { 'X-Request-Id': requestId } }
      );
    }
    logGenerationTelemetry({
      requestId,
      outcome: 'error',
      httpStatus: 500,
      errorCode: 'UNEXPECTED_ERROR',
      latencyMs: totalLatencyMs,
      attempts,
      repaired,
      inputChars,
    });
    return NextResponse.json(
      { error: 'Ocurrió un error inesperado al generar el diagrama.', requestId },
      { status: 500, headers: { 'X-Request-Id': requestId } }
    );
  }
}
