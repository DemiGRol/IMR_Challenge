# ADR-001: Estrategia de generación y layout BPMN 2.0

- **Estado**: aprobado (21/11/2026)
- **Requisitos**: `REQ-03`, `REQ-04`, `REQ-05`, `US-02`, `US-03`, `US-05`

## Contexto
Los LLM comprenden bien procesos en lenguaje natural, pero suelen fallar al generar coordenadas visuales (`<bpmndi:BPMNDiagram>`), produciendo nodos superpuestos o `no diagram to display` en `bpmn-js`. `REQ-03` exige que el LLM devuelva sintaxis BPMN.

## Alternativas evaluadas
1. **XML BPMN 2.0 completo con DI desde el LLM**: cumple `REQ-03`, pero alta tasa de diagramas ilegibles y truncamiento de tokens.
2. **XML BPMN 2.0 semántico (sin DI) desde el LLM + `bpmn-auto-layout` (Elegida)**: cumple `REQ-03`, separa semántica (LLM) de geometría (determinista), esfuerzo bajo (~1–2 h).
3. **JSON intermedio → conversor determinista a XML + `bpmn-auto-layout`**: máxima determinismo, pero mayor esfuerzo (~3–5 h) y desviación literal de `REQ-03`.

## Decisión
Adoptar **Opción B**: el LLM devuelve JSON estructurado (`{ bpmnXml, assumptions }`) donde `bpmnXml` es BPMN 2.0 XML semántico sin bloque DI (subconjunto MVP: `<bpmn:process>` con *StartEvent, EndEvent, Task/UserTask/ServiceTask, ExclusiveGateway, ParallelGateway, SequenceFlow*; sin Pools/Lanes). El backend valida/sanitiza el XML (anti-XXE, `bpmn-moddle`) y `bpmn-auto-layout` genera el `<bpmndi:BPMNDiagram>` antes de renderizar en `bpmn-js` Modeler.

## Consecuencias y rollback
- **Ventajas**: cumplimiento literal de `REQ-03`, diagramas legibles y editables, transparencia de supuestos (`assumptions`).
- **Riesgo a validar en `T-04`**: compatibilidad de `bpmn-auto-layout` v2.x con la versión de Node.js del runtime (requiere Node >= 22.12 si corre en servidor; alternativa: Node 22 en Vercel o ejecutar layout en cliente).
- **Rollback**: si `bpmn-auto-layout` falla en >= 2/3 fixtures del spike `T-04`, evaluar `yet-another-bpmn-auto-layout` o pasar a JSON intermedio (consultando flexibilidad de `REQ-03` a IMR).
