# Backlog inicial — propuesta, no aprobado
| ID | Entregable/tarea | Depende de | Prioridad | Estado | Evidencia |
|---|---|---|---|---|---|
| T-01 | Discovery mercado y alcance | — | P0 | aprobado | [market-research.md](discovery/market-research.md) |
| T-02 | USM, DFD-0, WBS, historias y aceptación | T-01 (parcial) | P0 | aprobado | [IMR.drawio](diagrams/IMR.drawio), [wbs.md](requirements/wbs.md), [user-stories.md](requirements/user-stories.md) |
| T-03 | Comparar arquitectura, representación BPMN y LLM; ADR | T-02 (parcial) | P0 | aprobado | [ADR-001](architecture/decisions/ADR-001-bpmn-strategy.md), [ADR-002](architecture/decisions/ADR-002-stack-and-hosting.md), [ADR-003](architecture/decisions/ADR-003-llm-provider-adapter.md), [ADR-004](architecture/decisions/ADR-004-no-embeddings-rag-mvp.md) |
| T-04 | Spike texto → LLM → BPMN editable | Aprobación de spike | P0 | verificado | `scripts/spike-bpmn.ts` (3/3 OK), `scripts/spike-vertex.ts` (`gemini-4-hydrogen` en `global`: 18.4s, `moddleWarnings=0`, `hasDI=true`) |
| T-05 | Implementar MVP vertical | T-03, T-04 | P0 | implementado | Rama `feat/mvp`; `npm run typecheck` OK (0 errores), `npm run build` OK |
| T-06 | Validar semántica, errores, UX y seguridad | T-05 | P0 | propuesta | |
| T-07 | Entrega reproducible y evidencia | T-05, T-06 | P0 | propuesta | |
| T-08 | Defensa y demo | T-03, T-07 | P0 | propuesta | |

P0: indispensable para entrega o proceso acordado. P1: mejora importante. P2: diferible. Revisar dependencias y estimaciones tras discovery; no declarar fechas intermedias confirmadas.
