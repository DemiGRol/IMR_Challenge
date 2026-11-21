import { GenerateBpmnInput, LlmGenerateResult, LlmProvider, LlmServiceError } from './types';

export class ResilientLlmAdapter {
  private readonly providers: LlmProvider[];
  private readonly timeoutMs: number;

  constructor(providers: LlmProvider[], timeoutMs = 180_000) {
    if (providers.length === 0) {
      throw new LlmServiceError('No hay proveedores LLM configurados.', 500, 'NO_PROVIDERS', false);
    }
    this.providers = providers;
    this.timeoutMs = timeoutMs;
  }

  async generate(
    input: GenerateBpmnInput,
    overrideTimeoutMs?: number
  ): Promise<LlmGenerateResult> {
    const effectiveTimeout = overrideTimeoutMs ?? this.timeoutMs;
    let lastError: unknown = null;

    for (let index = 0; index < this.providers.length; index++) {
      const provider = this.providers[index];
      const t0 = performance.now();
      const signal = AbortSignal.timeout(effectiveTimeout);

      try {
        const raw = await provider.generate(input, signal);
        return {
          bpmnXml: raw.bpmnXml,
          assumptions: raw.assumptions,
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
        lastError = err;
        const isLast = index === this.providers.length - 1;
        const shouldFallback =
          !isLast && (!(err instanceof LlmServiceError) || err.retryable);

        if (!shouldFallback) {
          if (err instanceof LlmServiceError) throw err;
          throw new LlmServiceError(
            'No se pudo obtener una respuesta válida del proveedor LLM. Intentá nuevamente.',
            502,
            'PROVIDER_ERROR',
            false
          );
        }
      }
    }

    throw new LlmServiceError(
      lastError instanceof Error ? 'Error inesperado al invocar el proveedor LLM.' : 'Error LLM.',
      502,
      'ADAPTER_EXHAUSTED',
      false
    );
  }
}
