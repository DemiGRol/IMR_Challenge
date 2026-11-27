import {
  type AnalyzeBpmnInput,
  type GenerateBpmnInput,
  type LlmAnalyzeResult,
  type LlmGenerateResult,
  type LlmProvider,
  LlmServiceError,
} from './types.ts';

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(
      new LlmServiceError('Solicitud cancelada por el usuario.', 499, 'CLIENT_ABORTED', false)
    );
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(
        new LlmServiceError('Solicitud cancelada por el usuario.', 499, 'CLIENT_ABORTED', false)
      );
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const MIN_FALLBACK_BUDGET_MS = 10_000;

export class ResilientLlmAdapter {
  private readonly providers: LlmProvider[];
  private readonly timeoutMs: number;
  private readonly retryDelayMs: number;

  constructor(providers: LlmProvider[], timeoutMs = 180_000, retryDelayMs = 2500) {
    if (providers.length === 0) {
      throw new LlmServiceError('No hay proveedores LLM configurados.', 500, 'NO_PROVIDERS', false);
    }
    this.providers = providers;
    this.timeoutMs = timeoutMs;
    this.retryDelayMs = retryDelayMs;
  }

  private computeAttemptTimeout(
    index: number,
    totalProviders: number,
    effectiveTimeout: number,
    remainingMs: number
  ): number {
    if (index === 0 && totalProviders > 1 && effectiveTimeout > 45_000) {
      return Math.min(
        remainingMs,
        Math.max(30_000, Math.round(effectiveTimeout * 0.65))
      );
    }
    return Math.max(1_000, remainingMs);
  }

  async generate(
    input: GenerateBpmnInput,
    overrideTimeoutMs?: number,
    externalSignal?: AbortSignal
  ): Promise<LlmGenerateResult> {
    const effectiveTimeout = overrideTimeoutMs ?? this.timeoutMs;
    const deadline = Date.now() + effectiveTimeout;
    let lastError: unknown = null;

    for (let index = 0; index < this.providers.length; index++) {
      if (externalSignal?.aborted) {
        throw new LlmServiceError(
          'Solicitud cancelada por el usuario.',
          499,
          'CLIENT_ABORTED',
          false
        );
      }

      const remaining = deadline - Date.now();
      if (index > 0 && remaining < MIN_FALLBACK_BUDGET_MS) {
        break;
      }

      const provider = this.providers[index];
      const attemptTimeout = this.computeAttemptTimeout(
        index,
        this.providers.length,
        effectiveTimeout,
        remaining
      );
      const t0 = performance.now();
      const timeoutSignal = AbortSignal.timeout(attemptTimeout);
      const signal = externalSignal
        ? AbortSignal.any([timeoutSignal, externalSignal])
        : timeoutSignal;

      try {
        const raw = await provider.generate(input, signal);
        return {
          bpmnXml: raw.bpmnXml,
          assumptions: raw.assumptions,
          recommendations: raw.recommendations || [],
          usage: raw.usage,
          finishReason: raw.finishReason,
          meta: {
            provider: provider.name,
            model: provider.model,
            latencyMs: Math.round(performance.now() - t0),
            fallbackUsed: index > 0,
            attempts: 1,
            repaired: Boolean(input.repairFeedback),
          },
        };
      } catch (err) {
        if (externalSignal?.aborted) {
          throw new LlmServiceError(
            'Solicitud cancelada por el usuario.',
            499,
            'CLIENT_ABORTED',
            false
          );
        }
        lastError = err;
        const isLast = index === this.providers.length - 1;
        const isTransient = !(err instanceof LlmServiceError) || err.retryable;
        const remainingAfter = deadline - Date.now();

        if (!isLast && isTransient && remainingAfter > MIN_FALLBACK_BUDGET_MS + this.retryDelayMs) {
          if (this.retryDelayMs > 0) {
            await sleep(this.retryDelayMs, externalSignal);
          }
          continue;
        }

        if (err instanceof LlmServiceError) throw err;
        throw new LlmServiceError(
          'No se pudo obtener una respuesta válida del proveedor LLM. Intentá nuevamente.',
          502,
          'PROVIDER_ERROR',
          false
        );
      }
    }

    if (lastError instanceof LlmServiceError) throw lastError;
    throw new LlmServiceError(
      lastError instanceof Error ? 'Error inesperado al invocar el proveedor LLM.' : 'Error LLM.',
      502,
      'ADAPTER_EXHAUSTED',
      false
    );
  }

  async analyze(
    input: AnalyzeBpmnInput,
    overrideTimeoutMs?: number,
    externalSignal?: AbortSignal
  ): Promise<LlmAnalyzeResult> {
    const effectiveTimeout = overrideTimeoutMs ?? this.timeoutMs;
    const capable = this.providers.filter((p) => typeof p.analyze === 'function');
    if (capable.length === 0) {
      throw new LlmServiceError(
        'Ningún proveedor LLM soporta análisis incremental.',
        500,
        'ANALYZE_UNSUPPORTED',
        false
      );
    }

    const deadline = Date.now() + effectiveTimeout;
    let lastError: unknown = null;

    for (let index = 0; index < capable.length; index++) {
      if (externalSignal?.aborted) {
        throw new LlmServiceError(
          'Solicitud cancelada por el usuario.',
          499,
          'CLIENT_ABORTED',
          false
        );
      }

      const remaining = deadline - Date.now();
      if (index > 0 && remaining < MIN_FALLBACK_BUDGET_MS) {
        break;
      }

      const provider = capable[index];
      const attemptTimeout = this.computeAttemptTimeout(
        index,
        capable.length,
        effectiveTimeout,
        remaining
      );
      const t0 = performance.now();
      const timeoutSignal = AbortSignal.timeout(attemptTimeout);
      const signal = externalSignal
        ? AbortSignal.any([timeoutSignal, externalSignal])
        : timeoutSignal;

      try {
        const raw = await provider.analyze!(input, signal);
        return {
          assumptions: raw.assumptions,
          recommendations: raw.recommendations,
          usage: raw.usage,
          finishReason: raw.finishReason,
          meta: {
            provider: provider.name,
            model: provider.model,
            latencyMs: Math.round(performance.now() - t0),
            fallbackUsed: index > 0,
          },
        };
      } catch (err) {
        if (externalSignal?.aborted) {
          throw new LlmServiceError(
            'Solicitud cancelada por el usuario.',
            499,
            'CLIENT_ABORTED',
            false
          );
        }
        lastError = err;
        const isLast = index === capable.length - 1;
        const isTransient = !(err instanceof LlmServiceError) || err.retryable;
        const remainingAfter = deadline - Date.now();

        if (!isLast && isTransient && remainingAfter > MIN_FALLBACK_BUDGET_MS + this.retryDelayMs) {
          if (this.retryDelayMs > 0) {
            await sleep(this.retryDelayMs, externalSignal);
          }
          continue;
        }

        if (err instanceof LlmServiceError) throw err;
        throw new LlmServiceError(
          'No se pudo analizar el diagrama BPMN actual. Intentá nuevamente.',
          502,
          'PROVIDER_ERROR',
          false
        );
      }
    }

    if (lastError instanceof LlmServiceError) throw lastError;
    throw new LlmServiceError(
      lastError instanceof Error ? 'Error inesperado al analizar el diagrama.' : 'Error LLM.',
      502,
      'ADAPTER_EXHAUSTED',
      false
    );
  }
}
