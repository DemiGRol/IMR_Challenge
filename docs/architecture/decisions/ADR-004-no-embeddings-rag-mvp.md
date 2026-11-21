# ADR-004: Descarte explícito de Embeddings / RAG en el MVP

- **Estado**: aprobado (21/11/2026)
- **Requisitos**: `REQ-01`–`REQ-06`, alcance MVP (sin base de datos)

## Contexto
Se evaluó si incorporar Embeddings / RAG para mejorar la generación de diagramas BPMN.

## Decisión
**Descartar Embeddings y RAG en el MVP.** En su lugar, usar un prompt estructurado con ejemplos canónicos (*few-shot*) del subconjunto BPMN 2.0 soportado y validación/auto-layout determinista.

## Motivo y consecuencias
- La entrada del usuario es una descripción autocontenida (10–4.000 caracteres); no existe un corpus documental corporativo que recuperar.
- Incorporar RAG introduciría una base de datos vectorial (fuera del alcance MVP sin DB), mayor latencia en el presupuesto de 20–30 s, riesgo de *drift* de modelos de embedding y complejidad innecesaria para 10–15 h.
- **Evolución Fase 2**: RAG sí tendría alto valor si la aplicación evolucionara a un entorno corporativo con cientos de procedimientos internos (SOPs), glosarios o plantillas BPMN propietarias.
