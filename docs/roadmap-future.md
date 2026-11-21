# Roadmap de Mejoras Futuras (Post-MVP / Fase 2)

- **Propósito**: centralizar propuestas de evolución surgidas durante discovery, pruebas reales, auditorías de especialistas y feedback del responsable, para evaluarlas una vez completados P0 y P1.
- **Estado**: documento vivo (actualizado el 21/11/2026).

| ID | Área | Propuesta | Origen | Valor esperado |
|---|---|---|---|---|
| **FUT-01** | LLM / Latencia | Selector de modo **"Rápido vs. Profundo"** (ajustando `thinkingConfig` en runtime) y/o procesamiento asíncrono con *streaming* o *polling* para procesos largos (> 30 s). | Prueba robusta 55 s + `DEL-09` (`llm-specialist`) | Reduce latencia percibida en demos y procesos extensos sin sacrificar calidad cuando se requiere profundidad. |
| **FUT-02** | Resiliencia LLM | Conectar proveedor/modelo de **fallback** en `ResilientLlmAdapter` (p. ej. Groq Free o Google AI Studio) ante `429 RESOURCE_EXHAUSTED` o caídas de Vertex AI. | `ADR-003` + `INC-07` | Evita interrupciones en vivo por límites RPM de Free Trial. |
| **FUT-03** | Layout BPMN | Evaluar motor de layout con canales ortogonales separados (p. ej. **ELK** / `elkjs`) o post-procesador de waypoints para evitar superposición de flujos en bucles consecutivos y permitir *wrapping* vertical. | `INC-09` + prueba robusta | Mayor legibilidad en diagramas largos con múltiples bucles. |
| **FUT-04** | Estándar BPMN | Soporte para **Lanes** (roles internos) y **Diagramas de Colaboración** (múltiples Pools + `messageFlow`). | Discovery `T-01` + `T-02` | Cubre procesos interdepartamentales y entre organizaciones. |
| **FUT-05** | Dominio / RAG | Incorporar **Embeddings / RAG** sobre un repositorio corporativo de procedimientos (SOPs), glosarios y plantillas BPMN propias. | `ADR-004` | Estandariza nomenclatura y reglas internas en entornos empresariales. |
| **FUT-06** | UI / Inspección | Panel colapsable para inspeccionar y copiar el XML BPMN 2.0 en vivo (`US-08`, P1). | `USM` / `WBS 6.3` | Transparencia técnica adicional para perfiles desarrolladores. |
| **FUT-07** | Producción / Escala | Reemplazar rate limiter *in-memory* por **Upstash Redis** (estado compartido entre instancias serverless) y agregar observabilidad/métricas de latencia p50/p95. | `DEL-03` (`software-architect`) | Control de abuso consistente en despliegue serverless multi-instancia. |
| **FUT-08** | Calidad / Evals | Suite automatizada de evaluación offline (5–10 casos de proceso + prompt injection) para medir regresión de validez BPMN y calidad de `assumptions` ante cambios de prompt. | `DEL-08` + `DEL-09` | Cambios de prompt seguros con métricas objetivas. |
