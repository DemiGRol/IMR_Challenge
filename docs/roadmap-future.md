# Roadmap de Mejoras Futuras (Post-Challenge / Fase 2)

- **Propósito**: centralizar qué capacidades propuestas ya fueron entregadas hasta `v0.7.1` y qué evoluciones reales quedan priorizadas para una fase productiva empresarial (IMR).
- **Estado**: documento vivo (actualizado el `26/11/2026`).

---

## 1. Capacidades del roadmap inicial ya implementadas (`v0.5.0` → `v0.7.1`)

| ID | Capacidad entregada | Versión | Implementación verificada |
|---|---|---|---|
| **FUT-01** | Selector **Rápido vs. Detallado** + cancelación cooperativa (`AbortController`) | `v0.7.0` / `v0.7.1` | `thinkingConfig` (`LOW`/`MEDIUM`) por modo en Vertex/Studio, modo `Rápido` por defecto, benchmark 18/18 OK y botón **Cancelar** durante generación. |
| **FUT-02** | Fallback resiliente ante `429` / timeouts (`ResilientLlmAdapter`) | `v0.5.0` / `v0.7.0` | Vertex AI (`gemini-4-hydrogen`) → Google AI Studio con *deadline* compartido (`ADR-005`). |
| **FUT-03** | Separación de carriles, evitación de obstáculos y ordenamiento multi-capa | `v0.5.0` → `v0.7.0` | `fallback-layout.ts`, `layout-postprocess.ts` y 7 reglas generales en `collaboration-layout.ts` (entradas/salidas múltiples, autopistas perimetrales, retornos superiores). |
| **FUT-04** | Colaboración BPMN 2.0 (Pools, Lanes, MessageFlows) y eventos avanzados | `v0.6.0` | Pools *white/black-box*, `BoundaryEvent` (interruptivos y no interruptivos), `EventBasedGateway`, `InclusiveGateway` con `default`, tareas tipadas y bucles/multi-instancia (`ADR-006`). |
| **FUT-06** | Inspector de XML BPMN 2.0 en vivo + importación/exportación `.bpmn`/`.svg` | `v0.5.0` / `v0.7.1` | Visor colapsable con copia al portapapeles, validación `NCName` y soporte multi-prefijo (`bpmn:` / `bpmn2:` / default namespace). |
| **FUT-08** | Suite automatizada + benchmark reproducible + auditoría de seguridad | `v0.6.0` / `v0.7.0` | `tests/core.test.ts` (33 tests unitarios/regresión) + `scripts/benchmark-modes.ts` + dashboard unificado (`dashboard.html`). |
| **FUT-10** | Caché SHA-256 versionada + refinamiento preservando ediciones (`preserve-edits`) + autosave local | `v0.5.0` → `v0.7.1` | `src/lib/cache.ts`, `iterationMode`, `loadRevision` y persistencia local de sesión en `localStorage`. |
| **FUT-12** | Auditoría semántica bajo demanda sin regenerar el dibujo (`POST /api/analyze-bpmn`) | `v0.7.0` | Re-análisis sobre diagrama generado, editado o `.bpmn` importado, excluyendo preguntas resueltas (`resolvedQuestions`). |

---

## 2. Roadmap futuro real (Post-Challenge / Paso a Producción)

| ID | Área | Propuesta | Valor esperado | Por qué se difiere |
|---|---|---|---|---|
| **FUT-11** | UX / Consultoría | **Responder supuestos inline** dentro de cada card y que el LLM actualice descripción + diagrama automáticamente en un paso guiado. | Convierte los supuestos en una entrevista asistida de relevamiento para consultores de IMR. | El ciclo ya queda cubierto con *Marcar como resuelto* + *Re-analizar* + *Refinar conservando ediciones*; sumar reescritura automática requiere nuevo contrato UX y pruebas dedicadas. |
| **FUT-09** | Ecosistema / MCP | Exponer validación, layout y generación como **MCP Server** para agentes internos de IMR (minutas, tickets, Drive). | Reutilización del dominio BPMN en flujos agénticos corporativos sin depender de la UI. | Excede la consigna web del challenge y requiere gestión de credenciales/auditoría corporativa. |
| **FUT-05** | Dominio / RAG | Incorporar **Embeddings / RAG** sobre repositorios de SOPs, glosarios y plantillas corporativas (`ADR-004`). | Estandariza nomenclatura y reglas internas en cuentas enterprise. | Descartado en MVP por latencia, costo $0 y mantenimiento de índices vectoriales sin necesidad declarada. |
| **FUT-07** | Producción / Escala | **Upstash Redis / Vercel KV** para caché y rate limit distribuido + **OAuth/JWT** + **Log Drains / OpenTelemetry** + *circuit breaker* de presupuesto USD diario. | Control consistente entre instancias serverless efímeras, trazabilidad centralizada y protección financiera estricta. | Decisión consciente de MVP stateless $0 sin base de datos ni fricción de login para la evaluación. |
| **FUT-13** | UX / Streaming | **Streaming SSE** con progreso real por fase (LLM → validación → layout → reparación) y modularización de `page.tsx` / `collaboration-layout.ts`. | Menor latencia percibida en diagramas extensos y mejor mantenibilidad a medida que crece el equipo. | `responseSchema` entrega JSON estructurado completo al final; optimizar con SSE no aporta riesgo/retorno favorable antes de la defensa. |
| **FUT-14** | Estándar BPMN | Soporte para **SubProcess colapsados/expandidos** y auto-layout opcional al importar `.bpmn` externos sin bloque DI. | Cobertura jerárquica para macroprocesos multi-nivel. | Requiere manejo de planos BPMN anidados y jerarquías recursivas en `collaboration-layout.ts`. |
