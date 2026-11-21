import { GenerateBpmnInput, LlmGenerateResult, LlmProvider, LlmServiceError } from './types';

export class ResilientLlmAdapter {
  private readonly providers: LlmProvider[];
  private readonly timeoutMs: number;

  constructor(providers: LlmProvider[], timeoutMs = 45_000) {
    if (providers.length === 0) {
      throw new LlmServiceError('No hay proveedores LLM configurados.', 500);
    }
    this.providers = providers;
    this.timeoutMs = timeoutMs;
  }

  async generate(input: GenerateBpmnInput): Promise<LlmGenerateResult> {
    let lastError: unknown = null;

    for (let index = 0; index < this.providers.length; index++) {
      const provider = this.providers[index];
      const t0 = performance.now();
      const signal = AbortSignal.timeout(this.timeoutMs);

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
          },
        };
      } catch (err) {
        lastError = err;
        const isAbort =
          err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
        if (index === this.providers.length - 1) {
          if (isAbort) {
            throw new LlmServiceError(
              'La generación excedió el tiempo máximo de espera. Intentá nuevamente.',
              504
            );
          }
          if (err instanceof LlmServiceError) {
            throw err;
          }
          throw new LlmServiceError(
            'No se pudo obtener una respuesta válida del proveedor LLM. Intentá nuevamente.',
            502
          );
        }
      }
    }

    throw new LlmServiceError(
      lastError instanceof Error ? 'Error inesperado al invocar el proveedor LLM.' : 'Error LLM.',
      502
    );
  }
}
