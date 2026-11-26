# Benchmark comparativo de modos (Rápido vs. Detallado) — v0.7.0

- Fecha de generación: 2026-11-25T23:12:17.379Z
- Corridas BPMN completadas: 18 / 18 (100% válidas en intento 1)
- Costo total estimado (Vertex AI PayGo): USD 0.7750
- Retries 429 dentro de corridas exitosas: 5 (en 4 corridas)
- Corridas abortadas por 429 DSQ (límite de 3 reintentos): 24 + 4 fetch failed

| Caso | Modo | Corridas | Éxito 1er intento | Mediana LLM (s) | Mediana Total (s) | Retries 429 | Mediana costo (USD) | Mediana tokens (out / think) | Elementos | Supuestos (alto impacto) | Recs BPMN |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Solicitud de vacaciones | Rápido | 3 | 100% | 14s | 15.26s | 2 | $0.0201 | 1161 / 783 | 9 | 2 (1) | 0 |
| Solicitud de vacaciones | Detallado | 3 | 100% | 25.38s | 25.39s | 0 | $0.0332 | 1333 / 2344 | 9 | 4 (1) | 0 |
| Compras corporativas actual | Rápido | 3 | 100% | 33.09s | 33.09s | 1 | $0.0424 | 3228 / 1726 | 23 | 3 (1) | 2 |
| Compras corporativas actual | Detallado | 3 | 100% | 55.41s | 55.42s | 1 | $0.0676 | 3551 / 4702 | 23 | 5 (2) | 3 |
| Mantenimiento industrial | Rápido | 3 | 100% | 28.53s | 31.6s | 1 | $0.0347 | 2731 / 1255 | 20 | 3 (2) | 1 |
| Mantenimiento industrial | Detallado | 3 | 100% | 53.24s | 53.24s | 0 | $0.0593 | 2835 / 4351 | 20 | 4 (2) | 1 |

## Disponibilidad y contención DSQ (`429 RESOURCE_EXHAUSTED`)

- **Calidad del generador vs. disponibilidad del endpoint:** Las 18 corridas válidas pasaron `validateAndLayoutBpmn` en el **primer intento (0 reparaciones)** con **100% de trazabilidad (`elementIds` y `sourceExcerpt`)**.
- **Impacto real de DSQ en `global`:** En la ventana 13:33–19:25 ART se registraron **24 tandas abortadas por `429`** (más **5 retries** resueltos dentro de 4 corridas exitosas).
- **Verificación en GCP Console:** IAM & Quotas (IMR-Challenge): gemini-4-hydrogen-qcd global = Ilimitado (Ajustable: No), Uso >90%: 0 (Dynamic Shared Quota).
- **Mitigación arquitectónica en la aplicación:** El benchmark desactivó a propósito el fallback para medir solo Vertex AI; la app web real activa fallback automático a Google AI Studio + caché 30 min + modo Rápido por defecto.