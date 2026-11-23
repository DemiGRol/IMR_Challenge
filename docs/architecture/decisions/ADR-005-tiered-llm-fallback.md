# ADR-005: Fallback de Paridad (Vertex AI ↔ Google AI Studio) y Control de Razonamiento

- **Estado**: aprobado (22/11/2026)
- **Requisitos / Incidentes**: `REQ-02`, `NFR-03`, `ADR-003`, `INC-07`, `INC-11`, `INC-13`, prueba V2 (`v1-stress-test.md`)

## Contexto y problemática empírica
Durante las pruebas de estrés V2 con un proceso de compras empresariales (38 elementos, 16 gateways, 47 flujos):
1. **Vertex AI Free Trial (`gemini-4-hydrogen`, `global`)** consumió **21.560 tokens** en un solo intento (`2.189` entrada + `3.911` salida + **`15.460` *thinking tokens*** — 71,7% del total) y disparó `429 RESOURCE_EXHAUSTED` ante ráfagas cortas por Dynamic Shared Quota (DSQ).
2. **Groq Free Tier** no pudo sostener procesos robustos: `openai/gpt-oss-120b` tiene un techo de **8.000 TPM** (insuficiente para > 20k tokens) y `llama-3.3-70b-versatile` devolvió `404` en la organización del proyecto.

## Decisión
1. **Retirar Groq de la cadena activa** (se mantiene el patrón `LlmProvider` desacoplado para enchufar otro proveedor en Fase 2 sin tocar dominio ni UI).
2. **Cadena activa con paridad 1:1 de capacidad**: **`VertexAiProvider` (Primario, `gemini-4-hydrogen`, crédito GCP \$300 sin límite fijo de 20 RPD)** → **`GoogleAiStudioProvider` (Fallback, `gemini-4-hydrogen`, Free Tier 5 RPM / 250k TPM / 20 RPD reservados exclusivamente para absorber `429` de Vertex AI en vivo)**. Ambos comparten el mismo SDK `@google/genai` y Structured Outputs nativos.
3. **Control real de latencia vs. calidad en ambos proveedores**:
   - **Modo Detallado (`detailed`)**: razonamiento dinámico por defecto (máxima fidelidad semántica).
   - **Modo Rápido (`fast`)**: `thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }` para reducir los *thinking tokens* y bajar latencia manteniendo validez estructural BPMN 2.0.

## Consecuencias y trade-offs
- **Ventajas**: elimina el cuello de botella de 8.000 TPM, mantiene paridad de calidad ante `429` de Vertex AI y permite comparar objetivamente razonamiento dinámico vs. `LOW` en los experimentos V3–V4.
- **Limitación conocida**: Google AI Studio Free Tier puede usar prompts para mejora de producto (aceptable para demos con procesos ficticios; en producción corporativa se usaría solo Vertex AI con cuota dedicada).
