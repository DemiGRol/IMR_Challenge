# Prueba de Estrés V1 — Hallazgos, Auditoría, Instrumentación y Diseño Experimental

- **Fecha**: 22/11/2026
- **Caso evaluado**: Proceso de compras empresariales (prueba de estrés funcional y semántica, V1).
- **Estado**: análisis y propuesta de instrumentación (sin modificar comportamiento funcional ni prompt del generador).

---

## 1. Hallazgos registrados de V1 (Trazabilidad)

| ID | Hallazgo observado en V1 | Tipo | Impacto |
|---|---|---|---|
| **V1-01** | Omisión de información explícita del usuario en el diagrama generado. | Fidelidad semántica | Alto |
| **V1-02** | Confusión entre completitud de datos y aprobación de solicitudes. | Semántica de negocio | Alto |
| **V1-03** | Escasa representación de determinadas excepciones del proceso. | Cobertura de flujos | Medio–Alto |
| **V1-04** | Especialización de tareas como `userTask` o `serviceTask` sin evidencia suficiente en el texto. | Sobre-especificación | Medio |
| **V1-05** | Pérdida de semántica temporal (plazos/timeouts) y responsabilidades (roles). | Alcance BPMN MVP | Medio |
| **V1-06** | Limitación fija a un máximo de 5 supuestos. | Restricción de prompt | Medio |
| **V1-07** | Posibles problemas de fidelidad durante sucesivas regeneraciones (`previousBpmnXml`). | Estabilidad iterativa | Medio–Alto |
| **V1-08** | Layout excesivamente horizontal en procesos extensos. | Legibilidad visual (`bpmn-auto-layout`) | Medio |

---

## 2. Auditoría exacta: ¿dónde se fija el límite de 5 supuestos?

Verificado directamente sobre el código fuente actual (22/11/2026):

| Capa | Archivo / Ubicación | ¿Impone límite de 5? | Evidencia |
|---|---|---|---|
| **Prompt del sistema** | `src/lib/llm/prompt.ts` (línea 4) | **SÍ (único lugar)** | `"assumptions": array de 0 a 5 objetos con cuatro campos en español` |
| **Esquema JSON Vertex AI** | `src/lib/llm/vertex-provider.ts` (líneas 162–171) | No | `Type.ARRAY` sin `maxItems`. |
| **Validación Zod Backend** | `vertex-provider.ts` (L15), `groq-provider.ts` (L14) | No | `z.array(AssumptionSchema).default([])` sin `.max(5)`. |
| **Frontend UI** | `src/app/page.tsx` | No | Renderiza `assumptions.map(...)` completo sin recorte. |

---

## 3. Revisión de observabilidad y propuesta de instrumentación mínima (sin cambiar comportamiento)

### Ya instrumentado en `src/lib/telemetry.ts`
`event`, `timestamp`, `requestId`, `outcome`, `httpStatus`, `errorCode`, `provider`, `model`, `fallbackUsed`, `cached`, `incremental`, `latencyMs`, `attempts`, `repaired`, `inputChars`, `outputXmlBytes`, `assumptionsCount`, `usage` (`promptTokens`, `outputTokens`, `thinkingTokens` en Vertex, `totalTokens`), `estimatedCostUsd`.

### Brechas mínimas a instrumentar antes de V2–V4 (solo telemetría, 0 cambios funcionales)
1. **`finishReason`**: capturar y loguear `finishReason` en respuestas exitosas y fallidas (`VertexAiProvider` y `GroqProvider`).
2. **`thinkingTokens` en Groq**: leer `usage.completion_tokens_details?.reasoning_tokens` en `groq-provider.ts` (ya verificado en `spike-groq.ts`).
3. **`mode`**: incluir `mode` (`'detailed' | 'fast'`) en el evento de telemetría.
4. **`validationSummary`**: devolver desde `validator.ts` métricas estructurales sin alterar la validación (`elementCount`, `gatewayCount`, `flowCount`, `edgeChannelsSeparated`, `initialValidationError` cuando hubo reparación).

---

## 4. Evaluación comparativa de alternativas (para mejoras posteriores a V2–V4)

| Alternativa | Calidad semántica | Latencia / Tokens / Coste | Complejidad / Mantenibilidad | UX | Prioridad antes del 27/11 |
|---|---|---|---|---|---|
| **1. Límites configurables o adaptativos de supuestos** | Media–Alta si se evita ruido (ej. "solo supuestos de alto impacto; sin tope rígido de 5, guía 3–8 según ambigüedad"). | +100–300 tokens de salida (~+1–2 s); coste marginal mínimo. | Muy baja (solo ajuste de prompt). | Riesgo de fatiga si aparecen > 8 cards sin jerarquía. | **Alta (probar en V3)** |
| **2. Clasificación por impacto semántico (`high` / `medium` / `low`)** | Alta: separa ambigüedades críticas (ej. aprobación vs. completitud) de detalles menores (`userTask`/`serviceTask`). | +50–100 tokens; latencia prácticamente igual. | Baja (1 enum en schema + badge en card). | Excelente: permite escanear primero lo crítico. | **Alta (probar en V3)** |
| **3. Visualización progresiva de supuestos secundarios** | Neutral (no cambia el modelo, mejora su lectura). | 0 tokens / 0 latencia. | Baja (solo UI: mostrar `high` visibles y colapsar `medium`/`low`). | Muy alta: elimina sobrecarga visual cuando hay > 5 supuestos. | **Alta (pareja natural de #2)** |
| **4. Distinción entre supuestos, omisiones, errores y limitaciones** | Alta para consultoría: evita mezclar limitaciones del MVP (sin Lanes/Timer) con ambigüedades del texto. | +150–250 tokens; riesgo de que el LLM clasifique mal si el schema es muy largo. | Media (requiere categorías claras en prompt + UI). | Buena si se limita a 2–3 etiquetas simples (`Supuesto`, `Omisión`, `Limitación MVP`). | **Media (evaluar tras V2)** |
| **5. Validación determinística complementaria** | Media–Alta en estructura (ej. detectar `task` vs. `userTask`, nodos desconectados, nombres vacíos). No detecta omisión de requisitos del texto. | 0 tokens / < 5 ms / \$0. | Baja–Media (reglas puras en `validator.ts`, testeables). | Transparente y confiable. | **Alta (baja complejidad)** |
| **6. Auditoría semántica bajo demanda (2ª llamada LLM opcional)** | Muy alta para detectar omisiones del texto original (`V1-01`, `V1-02`) sin penalizar la generación normal. | +10–25 s y 2× tokens **solo cuando el usuario la solicita**. | Media (nuevo endpoint/botón "Auditar fidelidad"). | Excelente: latencia cero en el flujo normal, potencia extra a pedido. | **Media (post-V3 si queda margen)** |
| **7. Preservación de elementos y ediciones manuales en regeneración** | Muy alta para `V1-07`: hoy `previousBpmnXml` envía el XML inicial, no el XML editado en `bpmn-js`. | 0 tokens extra (solo leer `modeler.saveXML()` antes de regenerar). | Baja–Media (exponer getter de XML actual en `BpmnEditor`). | Muy alta: respeta el trabajo manual del analista. | **Alta (muy bajo costo)** |

---

## 5. Diseño de experimentos comparativos (V2, V3, V4)

Para decidir con evidencia (y no por intuición) si ampliar supuestos o cambiar el prompt mejora realmente el resultado:

- **Base fija (mismo conjunto de 3 textos de prueba)**:
  - Caso A: Proceso de compras empresariales (V1).
  - Caso B: Proceso de onboarding con paralelismo y excepciones.
  - Caso C: Proceso corto ambiguo (2 párrafos) para medir sobre-generación de supuestos.
- **V2 (Baseline instrumentado — sin cambiar prompt ni límite)**:
  - Aplicar **solo la instrumentación mínima (§3)** y correr los 3 casos en modo `detailed` y `fast`.
  - Medir línea base: `promptTokens`, `outputTokens`, `thinkingTokens`, `latencyMs`, `estimatedCostUsd`, `finishReason`, `assumptionsCount`, `repaired`, y evaluar manualmente 4 métricas de calidad (omisiones explícitas, confusión semántica, tareas sobre-especializadas, utilidad real de supuestos).
- **V3 (Experimento A/B de supuestos y fidelidad — cambio acotado de prompt)**:
  - Comparar contra V2: (a) sin tope rígido de 5 + clasificación `impact: high | medium | low` + regla explícita de usar `bpmn:task` neutro cuando el texto no especifica si es humano o automático (`V1-04`), y (b) medir si aumentan o disminuyen las omisiones (`V1-01`) y el ruido en `assumptions`.
- **V4 (Validación de preservación en regeneración + visualización progresiva)**:
  - Probar 2 ciclos de edición manual + refinamiento incremental usando el XML actual del editor (`saveXML()`) y verificar que no se pierden ediciones previas (`V1-07`).

---

## 6. Notas de diseño registradas para evaluar post-V4 (sin tocar código aún)

1. **Preservación de ediciones manuales al regenerar (`V1-07`)**:
   - Confirmado: actualmente `previousBpmnXml` envía el último XML del backend, no el XML editado en `bpmn-js`.
   - **Estrategias a evaluar post-V4**:
     - *A (Recomendada, baja complejidad)*: leer `await modeler.saveXML()` del editor antes de enviar `POST /api/generate-bpmn`.
     - *B (Media)*: ofrecer dos acciones explícitas: **"Refinar diagrama actual"** (con `saveXML()`) vs. **"Regenerar desde cero"** (sin `previousBpmnXml`, para cortar deriva acumulada).
     - *C (Alta, Fase 2)*: parcheo estructurado (diff/patch de nodos BPMN) sin re-emitir todo el XML.
2. **Contrato de `processDescription` en regeneraciones**:
   - Actualmente el sistema espera la **descripción completa actualizada** (texto original + resolución de supuestos/omisiones), no un delta suelto. Evaluar post-V4 explicitarlo en la UI para evitar que el usuario borre el proceso original al querer aplicar un cambio puntual.

---

## 7. Resultados de Prueba V2 (22/11/2026 — Baseline instrumentado)

| ID | Hallazgo observado en V2 | Estado / Métrica |
|---|---|---|
| **V2-01** | Cobertura funcional/semántica: **13/15** criterios de aceptación aprobados y **2/15** parciales. | Mejora sustancial vs. V1 |
| **V2-02** | Los 5 supuestos identificados en V1 quedaron resueltos al incorporarlos a la descripción. | Verificado |
| **V2-03** | Persiste pérdida de información temporal explícita (plazos/timeouts). | Abierto (requiere `TimerEvent` o convención en etiquetas) |
| **V2-04** | **4 de los 5** nuevos supuestos se enfocaron en ejecución/granularidad (`userTask`/`serviceTask`), desplazando incertidumbres de negocio más relevantes. | Confirma necesidad de clasificación por impacto (`high`/`medium`/`low`) post-V4 |
| **V2-05** | El layout visual se degrada significativamente al aumentar la complejidad del proceso. | Confirmado (`bpmn-auto-layout` v1.x) |
| **V2-06** | Latencia saltó de **45,7 s (V1)** a **196,3 s (V2)** con **auto-reparación activada (`repaired: true`)**. | Crítico para UX/timeout |

### Investigación de auto-reparación en V2 (evidencia real de telemetría — `requestId: 947e7f84-ce4d-490d-a1c4-b53604c08264`)
- **Disparador exacto (`validation.initialError`)**: `"No se pudo calcular el layout visual del diagrama BPMN (Cannot set properties of undefined (setting 'length'))."` — fallo interno de `bpmn-auto-layout` v1.x sobre un grafo de alta densidad (**38 elementos, 16 gateways, 47 flujos**, `27.149 bytes`).
- **Llamadas al LLM**: **2 llamadas** (`attempts: 2`, `repaired: true`, `finishReason: STOP`, `mode: detailed`, `provider: vertex-ai`, `model: gemini-4-hydrogen`).
- **Consumo e impacto real**:
  - **Intento 2 registrado**: `promptTokens: 2.189`, `outputTokens: 3.911`, **`thinkingTokens: 15.460`** (**71,7%** del total), `totalTokens: 21.560`, `estimatedCostUsd: $0,049084`.
  - **Total estimado (Intento 1 + Intento 2)**: **196,3 s** (~98 s/intento), ~**43.000 tokens totales** (~30.000 *thinking tokens*) y ~**\$0,09–\$0,10 USD** (la telemetría actual sobrescribe `usage` con el intento 2; anotado para acumular ambos intentos post-V4).
- **Hallazgo adicional en corrida posterior (`requestId: bc94b157-5eb3-45ad-ac26-c5d8be04dc0f`)**:
  - Vertex AI devolvió `429 RESOURCE_EXHAUSTED` → el fallback a Groq se disparó en 7,8 s, pero devolvió **`404`**: `The model llama-3.3-70b-versatile does not exist or you do not have access to it.` (la cuenta de Groq sí tiene acceso verificado a `openai/gpt-oss-120b`).

---

## 8. Resultados de Prueba V3 — Éxito tras corrección técnica `v0.5.1` (23/11/2026)

> **Corrección de conclusión previa**: queda **descartada** la hipótesis inicial de incapacidad de `gemini-4-hydrogen` para procesar la complejidad de V3. El fallo anterior fue un **defecto técnico** (`INC-14`: bug `this.grid[-1].length` en `bpmn-auto-layout@1.0.0` sumado a contención transitoria `429`/`503`), ya mitigado con `buildFallbackLayout()` y cubierto por test de regresión en `tests/core.test.ts`.

### Métricas verificadas de V3 (`v0.5.1`)
| Métrica | V2 (`v0.4.x`) | V3 (`v0.5.1`) | Variación |
|---|---|---|---|
| **Proveedor / Modelo** | Vertex AI / `gemini-4-hydrogen` | Vertex AI / `gemini-4-hydrogen` | — |
| **Latencia LLM / HTTP total** | 196.318 ms (2 intentos) | **82.581 ms / 84.147 ms** | **−57%** |
| **Intentos / Reparación / Fallback** | 2 / sí / no | **1 / no / no** | Sin reintento |
| **Tokens (in / out / thinking / total)** | 2.189 / 3.911 / 15.460 / 21.560 *(solo intento 2)* | **2.442 / 4.309 / 8.521 / 15.272** | **−45% thinking** |
| **Costo estimado** | ~\$0,09–\$0,10 total (2 intentos) | **\$0,032808** | **−65%+** |
| **Estructura validada** | 38 elem / 16 gw / 47 flujos | **36 elem / 19 gw / 50 flujos** | Validación aprobada |

### Hallazgos funcionales de V3
- **Positivos**: representa las principales decisiones y excepciones de V3; los supuestos están mejor orientados a incertidumbres de negocio.
- **Brechas pendientes (prioridad acordada)**:
  - **P0 siguiente incremento**: soporte para **Pools, Lanes y Message Flows** (participantes, responsabilidades y comunicaciones entre organizaciones — a evaluar específicamente en **V4**).
  - **Secundarias**: plazos expresados como texto en vez de `TimerEvent`; estados finales diferenciados (compra cancelada / completada / pendiente de pago); clasificación de actividades como `userTask` sin evidencia suficiente de gestión por aplicación; layout aún muy horizontal.

### Auditoría de cobertura real de validaciones (`validator.ts` + `tests/core.test.ts`)
- **Cubierto y verificado (10/10 tests en `npm test`)**: anti-XXE (`<!DOCTYPE`/`<!ENTITY`), anti-XSS (`<script`, `javascript:`, `on*=`), XML bien formado vía `bpmn-moddle`, rechazo de `unresolved reference`, allowlist estricta del MVP (`startEvent`, `endEvent`, `task`, `userTask`, `serviceTask`, `exclusiveGateway`, `parallelGateway`, `sequenceFlow`), IDs únicos, `sourceRef`/`targetRef` válidos, separación de canales en bucles (`separateOverlappingEdges`), compactación sin DI (`compactBpmnForPrompt`) y layout determinista de respaldo (`buildFallbackLayout`).
- **Brechas actuales de validación (para el próximo incremento post-V4)**:
  - No valida conectividad/alcanzabilidad BFS desde `StartEvent` ni nodos huérfanos.
  - Rechaza explícitamente `bpmn:Collaboration`, `bpmn:Participant` (Pools), `bpmn:LaneSet`/`bpmn:Lane` y `bpmn:MessageFlow` (deberá ampliarse en el incremento de Colaboración).
  - Artefactos `.bpmn` exportados de V1–V3: conservarlos en `tests/fixtures/` para ejecutar regresión automática contra `validateAndLayoutBpmn` en cada cambio futuro.
