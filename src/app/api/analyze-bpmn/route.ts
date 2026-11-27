import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { compactBpmnForPrompt, countBpmnStats } from '@/lib/bpmn/validator';
import { ResilientLlmAdapter } from '@/lib/llm/adapter';
import { GoogleAiStudioProvider } from '@/lib/llm/gemini-studio-provider';
import { LlmProvider, LlmServiceError } from '@/lib/llm/types';
import { VertexAiProvider } from '@/lib/llm/vertex-provider';
import { checkRateLimit, extractClientIp } from '@/lib/rate-limit';
import { logGenerationTelemetry } from '@/lib/telemetry';

export const maxDuration = 120;

const AnalyzeRequestSchema = z.object({
  currentBpmnXml: z
    .string()
    .trim()
    .min(20, 'El diagrama BPMN actual está vacío o es inválido.')
    .max(150_000, 'El diagrama BPMN excede el tamaño máximo permitido.'),
  processDescription: z.string().trim().max(4000).optional().default(''),
  resolvedQuestions: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
  mode: z.enum(['detailed', 'fast']).default('fast'),
});

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const startedAt = performance.now();
  const ip = extractClientIp(req.headers);
  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Demasiadas solicitudes. Esperá unos segundos antes de volver a intentar.', requestId },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec), 'X-Request-Id': requestId } }
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

  const parsed = AnalyzeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Solicitud de análisis inválida.' },
      { status: 400 }
    );
  }

  const compactedXml = compactBpmnForPrompt(parsed.data.currentBpmnXml);
  const inputChars = parsed.data.processDescription.length;

  try {
    const hasStudio = Boolean(process.env.GEMINI_API_KEY?.trim());
    const hasVertex = Boolean(
      process.env.GCP_PROJECT_ID && process.env.GCP_SERVICE_ACCOUNT_JSON
    );
    const providers: LlmProvider[] = [];
    if (hasVertex) providers.push(new VertexAiProvider());
    if (hasStudio) providers.push(new GoogleAiStudioProvider());

    const adapter = new ResilientLlmAdapter(providers, 95_000);
    const result = await adapter.analyze(
      {
        currentBpmnXml: compactedXml,
        processDescription: parsed.data.processDescription,
        resolvedQuestions: parsed.data.resolvedQuestions,
        mode: parsed.data.mode,
      },
      undefined,
      req.signal
    );

    const totalLatencyMs = Math.round(performance.now() - startedAt);
    logGenerationTelemetry({
      requestId,
      operation: 'analyze',
      outcome: 'success',
      httpStatus: 200,
      errorCode: null,
      mode: parsed.data.mode,
      provider: result.meta.provider,
      model: result.meta.model,
      location: process.env.GCP_LOCATION || 'global',
      finishReason: result.finishReason,
      fallbackUsed: result.meta.fallbackUsed,
      cached: false,
      incremental: true,
      latencyMs: totalLatencyMs,
      attempts: 1,
      repaired: false,
      inputChars,
      assumptionsCount: result.assumptions.length,
      validation: { passed: true, ...countBpmnStats(parsed.data.currentBpmnXml) },
      usage: result.usage,
    });

    return NextResponse.json(
      {
        assumptions: result.assumptions,
        recommendations: result.recommendations,
        meta: result.meta,
      },
      { headers: { 'X-Request-Id': requestId } }
    );
  } catch (err) {
    const totalLatencyMs = Math.round(performance.now() - startedAt);
    if (err instanceof LlmServiceError) {
      logGenerationTelemetry({
        requestId,
        operation: 'analyze',
        outcome: 'error',
        httpStatus: err.statusCode,
        errorCode: err.code,
        mode: parsed.data.mode,
        latencyMs: totalLatencyMs,
        attempts: 1,
        repaired: false,
        inputChars,
      });
      return NextResponse.json(
        { error: err.message, requestId },
        { status: err.statusCode, headers: { 'X-Request-Id': requestId } }
      );
    }
    logGenerationTelemetry({
      requestId,
      operation: 'analyze',
      outcome: 'error',
      httpStatus: 500,
      errorCode: 'ANALYZE_UNEXPECTED_ERROR',
      mode: parsed.data.mode,
      latencyMs: totalLatencyMs,
      attempts: 1,
      repaired: false,
      inputChars,
    });
    return NextResponse.json(
      { error: 'Ocurrió un error inesperado al analizar el diagrama.', requestId },
      { status: 500, headers: { 'X-Request-Id': requestId } }
    );
  }
}
