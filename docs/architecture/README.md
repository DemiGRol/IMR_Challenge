# Arquitectura del Sistema (`as-built` · `v0.7.3`)

- **Estado**: `as-built` (`v0.7.3`, verificado el `26/11/2026`).
- **Estilo arquitectónico**: Monolito fullstack **Next.js (App Router + TypeScript)** desplegado en **Vercel Hobby** (`ADR-002`), frente a un backend separado que duplicaría latencia, CORS y mantenimiento sin beneficio en el alcance MVP.

---

## 1. Principios y límites del sistema

1. **Separación semántica vs. geometría (`ADR-001`)**: el LLM produce BPMN 2.0 XML semántico y estructurado (sin coordenadas DI); el servidor valida sintaxis/seguridad y calcula coordenadas `BPMNDiagram` de forma 100% determinista.
2. **Desacoplamiento multi-proveedor (`ADR-003` / `ADR-005`)**: todas las rutas API invocan la abstracción `ResilientLlmAdapter` (`LlmProvider`), que ejecuta **Vertex AI (`gemini-4-hydrogen` en `global`)** como primario y hace failover automático a **Google AI Studio** bajo un único *deadline* compartido.
3. **Stateless en servidor, resiliencia local en cliente (`ADR-002` / `ADR-004`)**: sin base de datos ni Embeddings/RAG. Caché SHA-256, rate limit y telemetría operan en memoria por instancia; el navegador persiste el borrador activo y preferencias visuales en `localStorage`.
4. **Frontera de confianza**: nunca se exponen credenciales (`GCP_SERVICE_ACCOUNT_JSON`, `GEMINI_API_KEY`, `TELEMETRY_API_TOKEN`) al navegador, ni se ejecuta salida del LLM como código ni HTML sin sanitizar.

---

## 2. Capas y diagramas de referencia

- **Contexto (DFD-0)**: [docs/diagrams/dfd-0.md](../diagrams/dfd-0.md)
- **Componentes (C4 Nivel 2)**: [docs/diagrams/architecture.md](../diagrams/architecture.md)
- **Secuencia End-to-End**: [docs/diagrams/sequence.md](../diagrams/sequence.md)
- **Estados del Editor y Sesión**: [docs/diagrams/states.md](../diagrams/states.md)
- **Contratos HTTP, LLM y `localStorage`**: [contracts.md](contracts.md)
- **Guía de setup Vertex AI / GCP**: [gcp-vertex-setup.md](gcp-vertex-setup.md)

### Registro de Decisiones de Arquitectura (ADRs)
- [ADR-001](decisions/ADR-001-bpmn-strategy.md): BPMN 2.0 XML semántico + layout determinista.
- [ADR-002](decisions/ADR-002-stack-and-hosting.md): Next.js (App Router, TypeScript) en Vercel Hobby (\$0).
- [ADR-003](decisions/ADR-003-llm-provider-adapter.md): Vertex AI vía patrón LLM Adapter.
- [ADR-004](decisions/ADR-004-no-embeddings-rag-mvp.md): Descarte explícito de Embeddings/RAG en MVP.
- [ADR-005](decisions/ADR-005-tiered-llm-fallback.md): Fallback Vertex AI → Google AI Studio con *deadline* compartido.
- [ADR-006](decisions/ADR-006-collaboration-and-events.md): Colaboración BPMN 2.0, eventos y layout determinista generalizado.

---

## 3. Modelo de amenazas y mitigaciones verificadas (`Threat Model`)

| Vector / Riesgo | Mitigación implementada | Evidencia en código / pruebas |
|---|---|---|
| **Prompt Injection en texto o XML previo** | Delimitación explícita con etiquetas XML escapando cierres (`escapeDelimiter`) + `responseSchema` estricto + validación posterior con `zod`. | [vertex-provider.ts](../../src/lib/llm/vertex-provider.ts), [gemini-studio-provider.ts](../../src/lib/llm/gemini-studio-provider.ts) |
| **XXE, XSS, bypass por entidades XML o `on*` handlers** | Bloqueo `<!DOCTYPE`, `<!ENTITY`, `<script`, `javascript:`, handlers DOM (permitiendo atributos benignos como `online=activo`), `NCName` obligatorio en todos los IDs y re-verificación post-layout. | [validator.ts](../../src/lib/bpmn/validator.ts), [BpmnEditor.tsx](../../src/components/BpmnEditor.tsx), `tests/core.test.ts` |
| **Abuso de cuota LLM y spoofing de IP** | Rate limit (10 req/min por IP, store acotado a 2.000 entradas FIFO) priorizando `x-vercel-forwarded-for` / `x-real-ip` / último salto confiable de `x-forwarded-for`. | [rate-limit.ts](../../src/lib/rate-limit.ts), `tests/core.test.ts` |
| **Fuga de credenciales o contenido sensible en logs** | Redacción de claves (`AIza...`, tokens Bearer, `private_key`) en errores SDK y telemetría JSON sin texto de procesos del usuario. | [vertex-provider.ts](../../src/lib/llm/vertex-provider.ts), [telemetry.ts](../../src/lib/telemetry.ts) |
| **Exposición pública de telemetría en producción** | En Vercel (`VERCEL=1`), `GET /api/telemetry` exige `TELEMETRY_API_TOKEN` (responde `404` si falta, `401` si no coincide) y restringe CORS por `TELEMETRY_CORS_ORIGIN`. | [route.ts](../../src/app/api/telemetry/route.ts) |
| **Clickjacking / MIME sniffing** | Cabeceras HTTP globales: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` y `CSP` (`frame-ancestors 'none'`). | [next.config.ts](../../next.config.ts) |
