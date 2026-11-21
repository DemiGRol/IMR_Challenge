# Contexto operativo vivo
Estado inicial: plantilla, sin implementación. Fecha de inicio: 20/11/2026. Entrega: 27/11/2026.
Objetivo: cumplir consigna y aprender orquestación, preservando capacidad de defensa.
Stack, modelo runtime, formato, arquitectura, persistencia, hosting: Next.js (App Router, TS) en Vercel Hobby ($0); Vertex AI en GCP (crédito $300) vía LLM Adapter (fallback en P1); BPMN 2.0 XML semántico + `bpmn-auto-layout` + JSON `{ bpmnXml, assumptions }`; sin DB ni Embeddings/RAG. Ver ADR-001 a ADR-004.
Entorno de desarrollo: Antigravity, Google AI Pro. Política inicial: coordinador Neon Low; Neon Medium para análisis y planificación; Neon High para decisiones críticas; Hydrogen Low para ejecución rutinaria. Consultar COORDINATOR.md §5.1. Configuración efectiva, cuota restante y ciclos de renovación: por comprobar.
Disponibilidad horaria personal: ~10–15 h totales hasta el 27/11/2026. Presupuesto: solo opciones gratuitas (crédito gratuito de $300 en GCP). Preferencia de entrega: aplicación desplegada públicamente en Vercel Hobby.
Preguntas IMR usadas: 0 enviadas (Q-01 registrada como propuesta en `docs/brief/questions.md`).
Decisiones aprobadas: T-01, T-02 y T-03 aprobados (ADR-001 a ADR-004); repositorio Git inicializado.
Bloqueos: confirmar acceso/credenciales de Vertex AI en GCP y versión local de Node.js para el spike T-04.
Último incremento verificado: T-03 cerrado con ADRs y contratos.
Siguiente paso propuesto: aprobar y ejecutar Spike T-04 (`texto → Vertex AI → BPMN semántico → bpmn-auto-layout → bpmn-js editable`).
Actualizar con decisiones, links, bloqueos y hechos duraderos; no volcar el chat completo.
