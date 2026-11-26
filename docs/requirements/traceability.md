# Matriz de Trazabilidad

- **Estado**: verificado (`v0.7.2` — cierre de entrega).

| Requisito IMR | Historia(s) | Tareas | ADR / Diseño | Verificación (TC) | Estado |
|---|---|---|---|---|---|
| `REQ-01` Entrada de texto de proceso | `US-01` | `T-02`, `T-05`, `T-06`, `T-12` | [ADR-002](../architecture/decisions/ADR-002-stack-and-hosting.md) · `src/app/page.tsx` (`10–4000` chars, ejemplos, autosave) | `npm test` (33/33) · UI responsive & accesibilidad | verificado |
| `REQ-02` Llamada a API LLM | `US-02` | `T-03`, `T-04`, `T-05`, `T-06`, `T-10`, `T-12` | [ADR-003](../architecture/decisions/ADR-003-llm-provider-adapter.md), [ADR-005](../architecture/decisions/ADR-005-tiered-llm-fallback.md) · `ResilientLlmAdapter`, `POST /api/generate-bpmn`, `POST /api/analyze-bpmn` | Benchmark 18/18 OK ([report.md](../quality/benchmark/report.md)) · `npm test` | verificado |
| `REQ-03` LLM devuelve sintaxis BPMN | `US-02`, `US-08` (P1) | `T-03`, `T-04`, `T-05`, `T-06`, `T-11` | [ADR-001](../architecture/decisions/ADR-001-bpmn-strategy.md), [ADR-006](../architecture/decisions/ADR-006-collaboration-and-events.md) · `validator.ts`, `repairer.ts`, auto-reparación | `npm test` (validación `NCName`, referencias, colaboración, multi-prefijo `.bpmn`) | verificado |
| `REQ-04` Procesar y visualizar con `bpmn.io` | `US-03` | `T-03`, `T-04`, `T-05`, `T-06`, `T-11` | [ADR-001](../architecture/decisions/ADR-001-bpmn-strategy.md), [ADR-006](../architecture/decisions/ADR-006-collaboration-and-events.md) · `layouter.ts` + `BpmnEditor.tsx` (`bpmn-js@18`) | `npm run spike:bpmn` (3/3) · `npm test` · `next build` | verificado |
| `REQ-05` Diagrama claro y editable | `US-03`, `US-04`, `US-05`, `US-07` (P1) | `T-04`, `T-05`, `T-06`, `T-11`, `T-12` | Puertos gateway, carriles, halo SVG, `Ctrl+clic`, `preserve-edits`, supuestos bidireccionales, `A/A/A`, Tour, tema claro/oscuro | `npm test` · `tsc --noEmit` (0 errores) · auditoría UX/UI `v0.7.2` | verificado |
| `REQ-06` Entrega web accesible / reproducible | `US-06` | `T-03`, `T-07`, `T-08`, `T-12` | [ADR-002](../architecture/decisions/ADR-002-stack-and-hosting.md) · `README.md`, `.env.example`, `vercel.json`, headers HTTP y rate limit | `npm run build` OK · Despliegue en `https://imr-challenge.vercel.app/` | verificado |
