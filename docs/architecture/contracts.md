# Contratos de API y LLM (Propuesto — T-03)

- **Estado**: propuesto (a validar en spike `T-04`).

## 1. Endpoint HTTP: `POST /api/generate-bpmn`

### Request (JSON)
```json
{
  "processDescription": "El cliente envía un pedido. Si hay stock, se prepara el envío y se factura; si no hay stock, se notifica el rechazo."
}
```
- Validación: string requerido, `10 <= length <= 4000` caracteres (trimmed).

### Response `200 OK` (JSON)
```json
{
  "bpmnXml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>...",
  "assumptions": [
    "Se asumió que la preparación del envío y la facturación ocurren en paralelo."
  ],
  "meta": {
    "provider": "vertex-ai",
    "model": "gemini-2.5-flash",
    "latencyMs": 2450
  }
}
```

### Errores controlados (sin stack traces ni secretos)
- `400 Bad Request`: entrada vacía, muy corta o > 4.000 caracteres.
- `429 Too Many Requests`: rate limit excedido (incluye `Retry-After`).
- `502 Bad Gateway` / `504 Gateway Timeout`: error del proveedor LLM, timeout o XML inválido tras validación.

## 2. Contrato interno del LLM Adapter (`LlmProvider`)
- Entrada: `{ processDescription: string }` + `AbortSignal`.
- Salida esperada del LLM (JSON Schema / Structured Outputs):
```json
{
  "bpmnXml": "<bpmn:definitions ...>...</bpmn:definitions>",
  "assumptions": ["string"]
}
```
