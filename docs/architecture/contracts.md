# Contratos de API, LLM y Estado Cliente (`as-built` · `v0.7.3`)

- **Estado**: `as-built` (`v0.7.3`, verificado contra `src/app/api/*`, `src/lib/llm/types.ts`, `src/app/page.tsx` el `26/11/2026`).

---

## 1. Endpoints HTTP

### 1.1 `POST /api/generate-bpmn`
- **Timeout Serverless (`maxDuration`)**: `300 s` (requiere Fluid Compute activo en Vercel Hobby; presupuesto interno `TOTAL_BUDGET_MS = 240_000 ms`, reintento auto-reparador reservando `MIN_REPAIR_BUDGET_MS = 30_000 ms`).

#### Request (JSON · esquema Zod)
```json
{
  "processDescription": "El cliente envía un pedido...",
  "previousBpmnXml": "<bpmn:definitions ...>...</bpmn:definitions>",
  "mode": "fast",
  "iterationMode": "fresh"
}
```
- `processDescription` *(requerido)*: `string` (trimmed), `10 <= length <= 4000`.
- `previousBpmnXml` *(opcional)*: `string`, `max 150_000` chars (el cliente remueve `<BPMNDiagram>` con `stripBpmnDi`).
- `mode` *(opcional, default `'fast'`)*: `'fast' | 'detailed'`.
- `iterationMode` *(opcional, default `'fresh'`)*: `'fresh' | 'preserve-edits'`.

#### Response `200 OK` (JSON + header `X-Request-Id`)
```json
{
  "bpmnXml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>...",
  "assumptions": [
    {
      "question": "¿La facturación y el envío ocurren en paralelo?",
      "assumption": "Se modelaron en paralelo tras verificar stock.",
      "impact": "medium",
      "elementIds": ["Gw_And_1", "Task_Facturar"],
      "sourceExcerpt": "se prepara el envío y se emite la factura en paralelo"
    }
  ],
  "recommendations": [
    {
      "title": "Diferenciar eventos de fin por resultado",
      "explanation": "Separar cierre exitoso de cierre rechazado.",
      "elementIds": ["End_Ok", "End_Rej"]
    }
  ],
  "meta": {
    "provider": "vertex-ai",
    "model": "gemini-4-hydrogen",
    "latencyMs": 12450,
    "attempts": 1,
    "repaired": false,
    "fallbackUsed": false,
    "cached": false,
    "incremental": false
  }
}
```

#### Errores controlados (sin stack traces ni secretos)
- `400 Bad Request`: JSON malformado o entrada fuera de rango (`10–4000` chars).
- `429 Too Many Requests`: rate limit local (`10 req/min` por IP, incluye `Retry-After` y `X-Request-Id`) o cuota `429` propagada del proveedor.
- `502 Bad Gateway`: XML BPMN inválido tras el ciclo acotado de auto-reparación o respuesta inválida del modelo.
- `500` / `503` / `504`: error inesperado, proveedores no configurados o timeout del presupuesto compartido.

---

### 1.2 `POST /api/analyze-bpmn`
- **Timeout Serverless (`maxDuration`)**: `120 s` (presupuesto `ResilientLlmAdapter = 95_000 ms`).
- **Propósito**: re-analizar un diagrama BPMN vivo sin modificar ni regenerar sus coordenadas ni XML.

#### Request (JSON · esquema Zod)
- `currentBpmnXml` *(requerido)*: `string` (trimmed), `20 <= length <= 150_000`.
- `processDescription` *(opcional, default `''`)*: `string`, `max 4000`.
- `resolvedQuestions` *(opcional, default `[]`)*: `string[]` (máximo 30 preguntas de 1–300 chars ya resueltas por el usuario).
- `mode` *(opcional, default `'fast'`)*: `'fast' | 'detailed'`.

#### Response `200 OK` (JSON + header `X-Request-Id`)
- `{ assumptions: StructuredAssumption[], recommendations: ModelingRecommendation[], meta: { provider, model, fallbackUsed, latencyMs } }`.

---

### 1.3 `GET /api/health`
Devuelve estado de configuración de proveedores sin exponer claves ni secretos:
```json
{
  "status": "ok",
  "primary": { "provider": "vertex-ai", "model": "gemini-4-hydrogen", "location": "global" },
  "fallback": { "provider": "google-ai-studio", "model": "gemini-4-hydrogen" },
  "configured": true,
  "timestamp": "2026-11-26T21:00:00.000Z"
}
```

---

### 1.4 `GET /api/telemetry` y `OPTIONS /api/telemetry`
- En entorno local (`VERCEL !== '1'`): abierto con CORS `*` y `Cache-Control: no-store`.
- En producción (`VERCEL === '1'`): exige `TELEMETRY_API_TOKEN` vía header `Authorization: Bearer <token>` o `X-Telemetry-Token`. Responde `404` si no hay token configurado en entorno y `401` si no coincide; CORS opcional solo vía `TELEMETRY_CORS_ORIGIN`.
- Response `200 OK`: `{ generatedAt, summary: { total, ok, errors, cached, fallbacks, repaired, totalEstimatedCostUsd, medianLatencyMs, byMode }, events }`.

---

## 2. Contrato interno del LLM Adapter (`src/lib/llm/types.ts`)

- **`LlmProvider`**:
  - `generate(input: GenerateBpmnInput, timeoutMs?: number): Promise<LlmGenerateResult>`
  - `analyze(input: AnalyzeBpmnInput, timeoutMs?: number): Promise<LlmAnalyzeResult>`
- **`GenerateBpmnInput`**: `{ processDescription, previousBpmnXml?, repairFeedback?, mode?: 'detailed' | 'fast' }`.
- **Structured Outputs**: esquema JSON validado con `zod` en cada proveedor antes de pasar a `validateAndLayoutBpmn`.
- **`ResilientLlmAdapter`**: ejecuta los proveedores configurados en cascada (`180_000 ms` por defecto en generación, `95_000 ms` en análisis), reservando `MIN_FALLBACK_BUDGET_MS = 10_000 ms` y deteniendo failover ante `LlmServiceError.retryable === false`.

---

## 3. Esquema de persistencia cliente (`localStorage`)

Al no existir base de datos en servidor (`ADR-002` / `ADR-004`), las preferencias y el borrador de trabajo residen localmente en el navegador:

| Clave `localStorage` | Contenido | Notas de seguridad / límite |
|---|---|---|
| `imr_session_draft_v1` | `{ description, generationMode, bpmnXml, assumptions, recommendations, resolvedIndices, resolvedHistory, diagramSource }` | Validado al hidratar; descarta XML `> 250_000` chars o con patrones `<!DOCTYPE`, `<!ENTITY`, `<script`, `javascript:`. |
| `imr_theme` | `'light' | 'dark'` | Aplicado por `THEME_INIT_SCRIPT` en `layout.tsx` antes del primer pintado. |
| `imr_font_size` | `'sm' | 'md' | 'lg'` | Controla escala tipográfica CSS (`15px` / `17px` / `19px`) y `--bpmn-label-size`. |
| `imr_tour_completed_v1` | `'true'` | Evita reabrir automáticamente `ProductTour` tras completarlo o saltarlo. |
