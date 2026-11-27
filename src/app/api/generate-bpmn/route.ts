import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  BpmnValidationError,
  compactBpmnForPrompt,
  countBpmnStats,
  validateAndLayoutBpmn,
} from '@/lib/bpmn/validator';
import { buildCacheKey, getCachedBpmn, setCachedBpmn } from '@/lib/cache';
import { ResilientLlmAdapter } from '@/lib/llm/adapter';
import { GoogleAiStudioProvider } from '@/lib/llm/gemini-studio-provider';
import { LlmProvider, LlmServiceError } from '@/lib/llm/types';
import { VertexAiProvider } from '@/lib/llm/vertex-provider';
import { checkRateLimit, extractClientIp } from '@/lib/rate-limit';
import { logGenerationTelemetry, TokenUsage } from '@/lib/telemetry';

function mergeUsage(a?: TokenUsage, b?: TokenUsage): TokenUsage | undefined {
  if (!a && !b) return undefined;
  return {
    promptTokens: (a?.promptTokens ?? 0) + (b?.promptTokens ?? 0),
    outputTokens: (a?.outputTokens ?? 0) + (b?.outputTokens ?? 0),
    thinkingTokens: (a?.thinkingTokens ?? 0) + (b?.thinkingTokens ?? 0),
    totalTokens: (a?.totalTokens ?? 0) + (b?.totalTokens ?? 0),
  };
}

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
  mode: z.enum(['detailed', 'fast']).default('fast'),
  iterationMode: z.enum(['fresh', 'preserve-edits']).default('fresh'),
});

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const startedAt = performance.now();
  const ip = extractClientIp(req.headers);
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
  const preserveEdits =
    parsed.data.iterationMode === 'preserve-edits' &&
    Boolean(parsed.data.previousBpmnXml?.trim());
  const compactedPreviousXml = preserveEdits
    ? compactBpmnForPrompt(parsed.data.previousBpmnXml as string)
    : undefined;
  const cacheKey = buildCacheKey(parsed.data.processDescription, mode);

  if (!preserveEdits) {
    const cachedEntry = getCachedBpmn(cacheKey);
    if (cachedEntry) {
      const totalLatencyMs = Math.round(performance.now() - startedAt);
      logGenerationTelemetry({
        requestId,
        outcome: 'success',
        httpStatus: 200,
        errorCode: null,
        mode,
        provider: cachedEntry.provider,
        model: cachedEntry.model,
        location: process.env.GCP_LOCATION || 'global',
        fallbackUsed: false,
        cached: true,
        incremental: false,
        latencyMs: totalLatencyMs,
        attempts: 0,
        repaired: false,
        inputChars,
        outputXmlBytes: Buffer.byteLength(cachedEntry.bpmnXml, 'utf8'),
        assumptionsCount: cachedEntry.assumptions.length,
        validation: { passed: true, ...countBpmnStats(cachedEntry.bpmnXml) },
      });
      return NextResponse.json(
        {
          bpmnXml: cachedEntry.bpmnXml,
          assumptions: cachedEntry.assumptions,
          recommendations: cachedEntry.recommendations || [],
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
  }

  const incremental = preserveEdits;
  let attempts = 1;
  let repaired = false;
  let initialValidationError: string | undefined;

  try {
    const hasStudio = Boolean(process.env.GEMINI_API_KEY?.trim());
    const hasVertex = Boolean(
      process.env.GCP_PROJECT_ID && process.env.GCP_SERVICE_ACCOUNT_JSON
    );
    const providers: LlmProvider[] = [];
    if (hasVertex) providers.push(new VertexAiProvider());
    if (hasStudio) providers.push(new GoogleAiStudioProvider());
    const adapter = new ResilientLlmAdapter(providers, 180_000);
    let result = await adapter.generate(
      {
        processDescription: parsed.data.processDescription,
        previousBpmnXml: compactedPreviousXml,
        mode,
      },
      undefined,
      req.signal
    );

    let layoutedXml: string;
    let totalUsage: TokenUsage | undefined = result.usage;

    try {
      layoutedXml = await validateAndLayoutBpmn(result.bpmnXml);
    } catch (validationErr) {
      if (!(validationErr instanceof BpmnValidationError)) throw validationErr;
      initialValidationError = validationErr.message;

      if (req.signal.aborted) {
        throw new LlmServiceError(
          'Solicitud cancelada por el usuario.',
          499,
          'CLIENT_ABORTED',
          false
        );
      }

      const remainingMs = TOTAL_BUDGET_MS - (performance.now() - startedAt);
      if (remainingMs < MIN_REPAIR_BUDGET_MS) {
        throw validationErr;
      }

      attempts = 2;
      repaired = true;
      result = await adapter.generate(
        {
          processDescription: parsed.data.processDescription,
          previousBpmnXml: compactedPreviousXml,
          repairFeedback: validationErr.message,
          mode,
        },
        Math.round(remainingMs),
        req.signal
      );
      totalUsage = mergeUsage(totalUsage, result.usage);
      layoutedXml = await validateAndLayoutBpmn(result.bpmnXml);
    }

    if (!preserveEdits) {
      setCachedBpmn(cacheKey, {
        bpmnXml: layoutedXml,
        assumptions: result.assumptions,
        recommendations: result.recommendations || [],
        provider: result.meta.provider,
        model: result.meta.model,
      });
    }

    const totalLatencyMs = Math.round(performance.now() - startedAt);
    logGenerationTelemetry({
      requestId,
      outcome: 'success',
      httpStatus: 200,
      errorCode: null,
      mode,
      provider: result.meta.provider,
      model: result.meta.model,
      location: process.env.GCP_LOCATION || 'global',
      finishReason: result.finishReason,
      fallbackUsed: result.meta.fallbackUsed,
      cached: false,
      incremental,
      latencyMs: totalLatencyMs,
      attempts,
      repaired,
      inputChars,
      outputXmlBytes: Buffer.byteLength(layoutedXml, 'utf8'),
      assumptionsCount: result.assumptions.length,
      validation: {
        passed: true,
        ...countBpmnStats(layoutedXml),
        initialError: initialValidationError,
      },
      usage: totalUsage,
    });

    return NextResponse.json(
      {
        bpmnXml: layoutedXml,
        assumptions: result.assumptions,
        recommendations: result.recommendations || [],
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
        mode,
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
        mode,
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
      mode,
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
