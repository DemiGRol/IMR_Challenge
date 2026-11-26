# Contexto operativo vivo
Estado inicial: plantilla, sin implementación. Fecha de inicio: 20/11/2026. Entrega: 27/11/2026.
Objetivo: cumplir consigna y aprender orquestación, preservando capacidad de defensa.
Stack, modelo runtime, formato, arquitectura, persistencia, hosting: Next.js (App Router, TS) en Vercel Hobby ($0); Vertex AI en GCP (`location=global`, `model=gemini-4-hydrogen`, crédito $300) vía LLM Adapter (fallback en P1); BPMN 2.0 XML semántico + `bpmn-auto-layout` + JSON `{ bpmnXml, assumptions }`; sin DB ni Embeddings/RAG. Ver ADR-001 a ADR-004.
Entorno de desarrollo: Antigravity, Google AI Pro. Política inicial: coordinador Neon Low; Neon Medium para análisis y planificación; Neon High para decisiones críticas; Hydrogen Low para ejecución rutinaria. Consultar COORDINATOR.md §5.1. Configuración efectiva, cuota restante y ciclos de renovación: por comprobar.
Disponibilidad horaria personal: ~10–15 h totales hasta el 27/11/2026. Presupuesto: solo opciones gratuitas (crédito gratuito de $300 en GCP). Preferencia de entrega: aplicación desplegada públicamente en Vercel Hobby.
Preguntas IMR usadas: 0 enviadas (Q-01 registrada como propuesta en `docs/brief/questions.md`).
Decisiones aprobadas: T-01, T-02, T-03 y T-04 verificados; Git Flow activo (`master` + `develop` + `feat/mvp`); delegación paralela aprobada para T-05.
Bloqueos: ninguno.
Último incremento verificado: **`v0.7.0` (`T-12`) verificado** — benchmark 18/18 OK (USD 0.7750), dashboard unificado + `/api/telemetry`, rediseño UI/UX (modo claro/oscuro animado, stepper 3 pasos, selector de fuente, Product Tour 5 pasos), layout BPMN generalizado (puertos de entrada/salida, autopistas perimetrales, ordenamiento multi-pool), multiselección `Ctrl+clic`, reordenamiento anclado de eventos adjuntos y hardening de seguridad (auditado por `quality-validator` y `software-architect`); `npm test` 32/32 OK, `tsc --noEmit` 0 errores, `next build` OK.
Siguiente paso propuesto: T-08 (preparación de defensa de 30 min y verificación en despliegue Vercel Hobby).
Actualizar con decisiones, links, bloqueos y hechos duraderos; no volcar el chat completo.
