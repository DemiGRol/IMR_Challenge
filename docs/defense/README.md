# Defensa técnica — IMR BPMN Studio (`v0.7.4`, 30 min)

> Guía operativa para la entrevista técnica basada exclusivamente en artefactos, pruebas y decisiones verificadas del repositorio (`README.md`, `docs/architecture/decisions/ADR-001..006`, `docs/diagrams/*`, `docs/quality/benchmark/report.md`, `docs/defense/issues-and-lessons.md` y `tests/core.test.ts`).

---

## 1. Guion sugerido (30 minutos)

| Bloque | Tiempo | Objetivo | Qué mostrar |
|---|---|---|---|
| **1. Problema y decisiones clave** | 4 min | Mostrar criterio de arquitectura y alcance MVP sin sobre-ingeniería. | Consigna ([challenge.md](../brief/challenge.md)) + 4 ADRs base + por qué LLM semántico separado de DI determinista (`ADR-001`). |
| **2. Demo guiada en vivo** | 9 min | Demostrar todo el ciclo de valor (*Describir → Modelar → Auditar → Editar → Exportar*). | URL en Vercel (`https://imr-challenge.vercel.app/`) o `localhost:3000` con modo claro/oscuro, Tour y ejemplo complejo. |
| **3. Arquitectura y resiliencia** | 7 min | Explicar qué pasa bajo el capó al generar, validar y auditar. | [architecture.md](../diagrams/architecture.md), [sequence.md](../diagrams/sequence.md), [states.md](../diagrams/states.md), `ResilientLlmAdapter` (`ADR-005`), `validator.ts` y `collaboration-layout.ts`. |
| **4. Evidencia empírica y seguridad** | 5 min | Respaldar decisiones con métricas reales y control de calidad. | Benchmark 18/18 (`dashboard.html`), costos USD, 35 tests (`npm test`) y cierre de auditoría (`INC-17`). |
| **5. Preguntas IMR y Roadmap** | 5 min | Responder preguntas técnicas y proyectar evolución productiva. | [roadmap-future.md](../roadmap-future.md) (qué ya se cerró vs. Redis, Auth, MCP Server, inline answers). |

---

## 2. Demo reproducible + Plan B ante fallos en vivo

### Caso A — Demo rápida (2–3 min, baja latencia)
1. Abrir la app (mostrar el cambio animado a modo oscuro y el selector de tamaño de fuente `A A A`).
2. Usar un ejemplo precargado o descripción mediana en modo **`Rápido`** (predeterminado): mostrar barra de progreso con opción **Cancelar** y respuesta rápida.
3. Hacer clic en una card de **Supuestos** para mostrar el zoom suave y resaltado cian en modo oscuro; mover una actividad (o seleccionar varias con **`Ctrl + clic`** para mover en bloque adaptando flujos externos).
4. Pulsar **Re-analizar diagrama actual** (`/api/analyze-bpmn`) tras marcar un supuesto como resuelto para mostrar *human-in-the-loop* sin perder ediciones.
5. Inspeccionar **XML** y descargar **`.bpmn`** / **`.svg`**.

### Caso B — Demo avanzada (capacidad BPMN 2.0 + layout general)
- Pegar el caso de **denuncia de siniestro vehicular** (3 Pools: *Aseguradora* con 3 Lanes + *Asegurado* arriba + *Taller Mecánico* abajo; `BoundaryEvent` interruptivo y no interruptivo; `InclusiveGateway` con `default`; `EventBasedGateway`; loop y multi-instancia; y 2 recomendaciones técnicas BPMN en el panel lateral).
- Seleccionar los 2 eventos adjuntos de *Consultar servicio antifraude* para mostrar la barra contextual anclada sobre la tarea y el botón **Intercambiar** adaptando los flujos al instante.

### Caso C — Meta-demo ("IMR BPMN Studio se modela a sí mismo")
- Texto calibrado (~1.100 chars) para exhibir en una sola corrida **3 Pools** (*Analista externo*, *IMR BPMN Studio* con **3 Lanes**, *Proveedores IA*), tareas tipadas, **Boundary Events** (`Timer` + `Error`), **XOR**, **AND**, **InclusiveGateway**, **MessageFlows** y fin exitoso vs. error:

> El proceso de **IMR BPMN Studio** comienza cuando un **Analista** externo envía la descripción textual de un proceso al área de **API y Seguridad**. Primero, el sistema valida el formato y verifica el límite de solicitudes por usuario; si supera la cuota permitida, rechaza la petición y el proceso finaliza por error de cuota. Si está permitido, consulta si ya existe un diagrama en caché para una generación nueva: si existe, entrega directamente el diagrama al área de **Editor Web**; si no existe, envía la solicitud al servicio externo de **Proveedores IA** (Vertex AI). Si la consulta a Vertex AI falla o excede el plazo máximo de espera, se dispara automáticamente la derivación al proveedor de respaldo (Google AI Studio). Al recibir la respuesta estructurada con el XML semántico y los supuestos, el área de **Motor BPMN** valida la seguridad, los identificadores y las reglas del estándar: si detecta un error estructural, solicita una auto-reparación a **Proveedores IA**; si falla nuevamente, el proceso finaliza por error de validación. Cuando el modelo es válido, el **Motor BPMN** calcula el layout determinista con coordenadas. A continuación, en paralelo, **API y Seguridad** registra los costos y la telemetría en memoria mientras **Editor Web** renderiza el diagrama editable y resalta los supuestos detectados. Finalmente, el **Analista** puede realizar una o más de las siguientes acciones: ajustar elementos manualmente en el lienzo, solicitar un re-análisis de supuestos sin sobrescribir el dibujo, o exportar el resultado en formato `.bpmn` o `.svg`, finalizando el proceso de modelado exitoso.

### Plan B (si Vertex AI devuelve `429 RESOURCE_EXHAUSTED` o cae la red)
1. El sistema activa automáticamente el **fallback a Google AI Studio** (`ADR-005`) dentro del presupuesto único de `ResilientLlmAdapter`.
2. Si ambos proveedores están limitados en vivo:
   - Usar el **ejemplo precargado cacheado** (hit instantáneo en `< 20 ms`, manteniendo intacta la interacción en el editor).
   - O pulsar **Importar `.bpmn`** y cargar cualquiera de los 18 artefactos reales guardados en [docs/quality/benchmark/artifacts/](../quality/benchmark/artifacts/) (y ejecutar **Re-analizar** o edición manual + exportación `.svg`).
   - Mostrar [dashboard.html](../quality/benchmark/dashboard.html) con las 18 corridas reales verificadas y la pestaña de telemetría en vivo.

---

## 3. Cómo funciona el flujo end-to-end

1. **Entrada cliente (`src/app/page.tsx`)**: valida longitud (`10–4.000` chars), guarda borrador automático en `localStorage` (`imr_session_draft_v1`), permite abortar con `AbortController` y, al refinar o re-analizar, envía el XML en vivo limpiando `<BPMNDiagram>` (`stripBpmnDi`) más las últimas 30 preguntas resueltas.
2. **Guardias API (`generate-bpmn` / `analyze-bpmn`)**:
   - Extracción confiable de IP (`x-vercel-forwarded-for` / `x-real-ip` / último salto en `x-forwarded-for`) + rate limit (`10 req/min`, tienda acotada a 2.000 entradas FIFO).
   - Validación de contrato con `zod` y verificación de caché SHA-256 versionada (`CACHE_VERSION` + modelo + modo + descripción normalizada, omitida en `preserve-edits`).
3. **Capa LLM (`ResilientLlmAdapter`)**:
   - Delimita entradas con etiquetas XML escapadas (`<process_description>`, `<previous_bpmn_xml>`), fuerza JSON estructurado con `responseSchema` y valida con `zod` + `finishReason` (`MAX_TOKENS`, `SAFETY`).
   - Comparte un único *deadline* entre proveedor primario (Vertex AI `global`) y fallback (Google AI Studio) para no exceder `maxDuration`.
4. **Validación y Layout determinista (`src/lib/bpmn/`)**:
   - Sanitiza patrones prohibidos antes y después del layout, exige `id` con formato `NCName` válido, parsea con `bpmn-moddle` (whitelist de 18 tipos BPMN 2.0, reglas de Pools/MessageFlows/BoundaryEvents).
   - Si hay Colaboración, Lanes o `BoundaryEvent` → `collaboration-layout.ts` (DAG longest-path, ordenamiento de Pools, puertos simétricos de entrada/salida, autopistas perimetrales). Si es proceso simple → `bpmn-auto-layout` con respaldo determinista `buildFallbackLayout()` ante fallos (`INC-14`). Post-proceso `separateOverlappingEdges` separa carriles solapados.
5. **Renderizado y edición (`src/components/BpmnEditor.tsx`)**: `bpmn-js@18` cargado dinámicamente (`ssr: false`), soporta `Ctrl+clic` multiselección, reordenamiento anclado de eventos adjuntos, dark mode SVG nativo y exportación `.bpmn`/`.svg`.

---

## 4. Pruebas reales, métricas verificadas y limitaciones

- **Pruebas automatizadas (`npm test`)**: **35/35 pruebas** aprobadas sobre `validator.ts`, `collaboration-layout.ts`, `fallback-layout.ts`, `layout-postprocess.ts`, `cache.ts`, `rate-limit.ts`, `telemetry.ts` y `ResilientLlmAdapter` (incluye tests de inyección por entidades XML, `NCName`, puertos convergentes/divergentes, compactación densa entre carriles ascendentes, `MessageFlow` paralelos y failovers).
- **Compilación y tipos**: `tsc --noEmit` (**0 errores**) y `next build` limpio (`115 kB` First Load JS en `/`, cierres `v0.7.2`–`v0.7.4`).
- **Benchmark comparativo de modos (`docs/quality/benchmark/report.md`)**: **18/18 corridas exitosas** (3 escenarios × 2 modos × 3 repeticiones), costo total medido de **`USD 0.7750`**, comparando latencia, tokens (`thinkingTokens`), reparaciones y detección de supuestos entre `Rápido` (`LOW`) y `Detallado` (`MEDIUM`).
- **Limitaciones conscientes (MVP stateless)**: caché, rate-limit y telemetría viven en memoria por instancia serverless (sin DB ni auth); `SubProcess` y `ComplexGateway` quedan fuera del subconjunto BPMN; en Vercel Hobby se requiere **Fluid Compute** activo para sostener `maxDuration = 300` / `120` (sin él recorta a `60 s`).

---

## 5. Aportes humanos vs. asistencia con agentes

- **Contribución y gobierno humano**: definición del alcance contra `challenge.md`, aprobación de todas las arquitecturas y ADRs (`ADR-001..006`), creación y operación de cuenta GCP/Vertex/Vercel, ejecución e interpretación de los experimentos reales y benchmark de 18 corridas, detección empírica de fallas visuales en diagramas complejos (ej. orden de eventos adjuntos, entrecruzamientos de saltos largos, puertos de entrada convergentes, barra contextual distante, tamaño de fuente y multiselección `Ctrl+clic`), y aprobación explícita de cada incremento antes de cerrar y publicar.
- **Uso transparente de agentes**: delegación especializada bajo rol coordinador (arquitectura, UX/UI, BPMN, LLM, backend/frontend y auditoría independiente de seguridad `quality-validator` + `software-architect`) siguiendo reglas trazables de verificación antes de declarar éxito.

---

## 6. Preguntas técnicas frecuentes y cómo responderlas

1. **¿Por qué el LLM genera XML semántico sin coordenadas y el layout corre en el servidor?**
   - *Respuesta (`ADR-001`)*: Los LLMs razonan bien sobre estructura de negocio y reglas BPMN, pero cometen errores geométricos graves si calculan píxeles `(x, y)` y waypoints ortogonales. Separarlo permite validar el grafo con `bpmn-moddle` y aplicar layout determinista repetible y testeable por regresión en servidor.
2. **¿Cómo evitan que el LLM devuelva XML roto, tags peligrosos o elementos fuera de alcance?**
   - *Respuesta*: Triple barrera: (1) `responseSchema` + Zod en la frontera LLM; (2) `NCName`, lista explícita de 18 tipos BPMN, reglas semánticas (`BoundaryEvent`, `MessageFlow` entre Pools) y `FORBIDDEN_PATTERNS` antes y después del layout; (3) hasta 1 auto-reparación acotada por presupuesto devolviendo el `BpmnValidationError` exacto al modelo.
3. **¿Qué pasa si `bpmn-auto-layout` falla con un proceso complejo con bucles?**
   - *Respuesta (`INC-14`)*: Descubrimos en pruebas reales que `bpmn-auto-layout@1.0.0` crashea en ciertos grafos densos (`adjustGridPosition`). En vez de desperdiciar otro llamado LLM, activamos `buildFallbackLayout()` en < 5 ms sobre XML ya validado por `bpmn-moddle`; y para colaboraciones/swimlanes/eventos adjuntos usamos nuestro motor `collaboration-layout.ts`.
4. **¿Por qué eligieron Vertex AI (`gemini-4-hydrogen`) + Google AI Studio y no OpenAI directo?**
   - *Respuesta (`ADR-003` / `ADR-005`)*: Créditos gratuitos disponibles en GCP (\$300) y buen desempeño en salidas estructuradas con `thinkingConfig` configurable. Todo está detrás de la interfaz `LlmProvider` (`ResilientLlmAdapter`), por lo que agregar o cambiar a OpenAI/Anthropic es implementar un adaptador nuevo sin tocar UI ni rutas.
5. **¿Cómo controlan latencia, costos y rate limits (`429`) en producción?**
   - *Respuesta*: Modo **`Rápido`** por defecto (`ThinkingLevel.LOW`), caché SHA-256 versionada de 30 min (excluida en refinamientos con ediciones manuales), *deadline* compartido en `ResilientLlmAdapter`, estimación real de costos por tokens/región en `telemetry.ts`, rate limiter por IP (10 req/min) con headers confiables y botón **Cancelar** conectado a `AbortController`.
6. **¿Cómo protegen la app contra Prompt Injection y XSS?**
   - *Respuesta (`INC-17`)*: Delimitadores XML con escape de cierres, `ALLOWED_FLOW_TYPES`, `NCName` en todos los IDs para impedir bypass con entidades XML, chequeo post-layout, sanitización cliente al importar `.bpmn`, headers HTTP (`X-Frame-Options: DENY`, `nosniff`, CSP base) y React sin `innerHTML`.
7. **¿Por qué no guardan procesos en base de datos ni tienen login?**
   - *Respuesta (`ADR-002` / `ADR-004`)*: No estaba en los requisitos, evita costos fijos y elimina riesgo de retener procesos confidenciales de clientes en servidor durante una demo pública. Sumamos autosave local en `localStorage` (`v0.7.1`) para no perder trabajo ante recargas; el paso natural a producción es Redis/KV + OAuth + Postgres.
8. **¿Qué métricas reales obtuvieron en el benchmark?**
   - *Respuesta*: 18/18 corridas exitosas (`USD 0.7750` total), verificando en el dashboard unificado que `Rápido` reduce latencia y consumo frente a `Detallado` preservando la validez BPMN 2.0, además de capturar los costos y fallos `429` por congestión `DSQ` en horario pico.
