# ADR-006: Soporte de Colaboración BPMN 2.0 (Pools, Lanes, Message Flows) y Eventos Intermedios

- **Estado**: aprobado (24/11/2026)
- **Requisitos / Hallazgos**: `REQ-03`–`REQ-05`, V3 (`v1-stress-test.md`), `FUT-04` promovido a P0 para `v0.6.0`.

## Contexto y evidencia verificada
1. En las pruebas V1–V3, el generador no utilizaba Pools, Lanes, Message Flows ni eventos intermedios (temporizadores, mensajes, alertas/escalaciones) porque la allowlist inicial de `validator.ts` y `prompt.ts` los restringía al subconjunto básico MVP.
2. Inspección directa de `node_modules/bpmn-auto-layout/dist/index.cjs` (líneas 1125–1127) confirmó que `bpmn-auto-layout@1.0.0` **solo lee el primer `<bpmn:process>`** e ignora `<bpmn:collaboration>`, `<bpmn:participant>`, `<bpmn:laneSet>` y `<bpmn:messageFlow>`.

## Decisión
1. **Layouter determinista de Colaboración/Swimlanes (`src/lib/bpmn/collaboration-layout.ts`)**:
   - Sin dependencias externas nuevas (< 10 ms en servidor).
   - Procesos simples sin Pools/Lanes ni `BoundaryEvent` continúan usando `bpmn-auto-layout` (+ `separateOverlappingEdges` + `fallback-layout.ts`).
   - Diagramas con `<bpmn:collaboration>`, `<bpmn:laneSet>` o `<bpmn:boundaryEvent>` utilizan `buildCollaborationLayout()`: Pools apilados verticalmente (*white-box* y *black-box*), Lanes horizontales (`isHorizontal="true"`), columnas BFS topológicas con gravedad vertical para reducir cruces, puertos direccionales en compuertas divergentes (evitando superposición sobre la marca `/` del flujo por defecto), eventos de borde (`BoundaryEvent`) anclados sobre el borde inferior de su tarea padre con expansión automática de altura del Lane, `sequenceFlow` ortogonales con canales de bucle y separación de corredores horizontales/verticales (`separateOverlappingEdges`), y `messageFlow` entre Pools con detección y evasión de obstáculos intermedios.
2. **Subconjunto BPMN 2.0 ampliado (`validator.ts` + `prompt.ts`)**:
   - Colaboración: `Collaboration`, `Participant` (Pools), `LaneSet`, `Lane`, `MessageFlow` (validando que conecte Pools distintos).
   - Eventos, tareas y compuertas: `intermediateCatchEvent`, `intermediateThrowEvent`, `boundaryEvent` (Timer / Error / Message, interruptivo y no interruptivo `cancelActivity="false"`, validando `attachedToRef` hacia una tarea válida y sin flujos entrantes), `eventBasedGateway`, `inclusiveGateway` (split/join), `sendTask`, `receiveTask`, `manualTask`, `scriptTask`, `businessRuleTask`, flujo por defecto (`default="Flow_ID"`), y definiciones estándar (`timerEventDefinition`, `messageEventDefinition`, `errorEventDefinition`, `escalationEventDefinition`, `signalEventDefinition`, `conditionalEventDefinition`, `terminateEventDefinition`).
   - Modos de ejecución de actividades: `standardLoopCharacteristics` (bucle), `multiInstanceLoopCharacteristics` (paralelo) y `multiInstanceLoopCharacteristics isSequential="true"` (secuencial).
   - Tareas neutras (`task`) cuando no haya evidencia suficiente de intervención humana o automatización (`V1-04`), diferenciación entre resultados desfavorables normales del negocio (`endEvent` convencional) y excepciones técnicas (`errorEventDefinition`), y tarjetas separadas de `recommendations` técnicas de modelado BPMN.
   - Estimación de costos (`telemetry.ts`): tabla de tarifas reales por modelo y región según Google Cloud Vertex AI / Model Garden (`gemini-4-hydrogen`, `gemini-4-neon`, `gemini-2.5-pro`, `gemini-2.5-flash`).
3. **Exclusiones explícitas en esta versión**:
   - Quedan fuera de alcance en generación automática (mantenidos para evolución futura o edición manual en `bpmn-js`): `SubProcess` expandido, `ComplexGateway`, compuertas instanciadoras basadas en eventos (`instantiate="true"`), eventos `Link`/`Compensation`, flujos condicionales directos desde actividades (`conditionExpression` sin gateway), Artefactos estándar (`DataObject`, `Group`, `TextAnnotation`) y extensiones propietarias GRC (Rol, Aplicación, Norma, Riesgo, Control) para preservar portabilidad estricta OMG BPMN 2.0.

## Consecuencias y rollback
- **Ventajas**: cumplimiento semántico completo de procesos multi-área y multi-organización con pictogramas BPMN 2.0 reales en `bpmn-js`, latencia adicional mínima (< 10 ms de layout), 100% cubierto por tests unitarios.
- **Limitación conocida**: en procesos muy largos dentro de una misma Lane, el flujo sigue creciendo horizontalmente (editable en `bpmn-js`).
- **Rollback**: revertir la rama `feat/collaboration-pools-lanes` restaura `v0.5.1` intacto.
