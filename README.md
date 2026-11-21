# IMR BPMN Studio — Generador de Procesos BPMN 2.0

Aplicación web que transforma descripciones textuales de procesos de negocio en diagramas **BPMN 2.0** válidos, legibles y editables interactivamente mediante **bpmn.io (`bpmn-js`)**, impulsada por **Vertex AI (GCP)** a través de un patrón **LLM Adapter**.

---

## Características implementadas (MVP)
- **Descripción en lenguaje natural** (10–4.000 caracteres) con auto-expansión del campo y 3 ejemplos precargados (lineal, decisión XOR, paralelismo AND).
- **Generación BPMN 2.0 semántica** vía **Vertex AI (`gemini-4-hydrogen` en `global`)** con Structured Outputs (`{ bpmnXml, assumptions }`) y hasta 1 reintento automático de reparación ante fallos de validación.
- **Supuestos accionables**: cada ambigüedad detectada se muestra como pregunta accionable + decisión asumida por el sistema.
- **Validación determinista y seguridad**: bloqueo anti-XXE/HTML arbitrario, allowlist de elementos BPMN 2.0 del MVP, validación con `bpmn-moddle`, layout automático con `bpmn-auto-layout`, credenciales exclusivamente en servidor y rate limiting por IP (`429`).
- **Editor interactivo `bpmn-js` Modeler**: edición completa de nodos, etiquetas y flujos, creación de diagrama en blanco, zoom, centrado automático, deshacer/rehacer reales, atajo `Ctrl+Enter`, protección ante sobrescritura (`isDirty`), panel lateral colapsable y exportación a **`.bpmn`** y **`.svg`**.

---

## Requisitos previos
- **Node.js >= 22.12** (verificado en `v24.16.0`) y `npm`.
- Proyecto en **Google Cloud Platform (GCP)** con **Vertex AI API** habilitada, **Billing** activo (Free Trial \$300 o cuenta paga) y una **Service Account** con rol `Vertex AI User` (`roles/aiplatform.user`).

---

## Instalación y ejecución local (desde cero)

```bash
# 1. Clonar e instalar dependencias
git clone https://github.com/DemiGRol/IMR_Challenge.git
cd IMR_Challenge
npm install

# 2. Configurar variables de entorno locales
cp .env.example .env.local
```

Completá `.env.local` con tus credenciales de GCP (ver guía detallada en [docs/architecture/gcp-vertex-setup.md](docs/architecture/gcp-vertex-setup.md)):

```env
GCP_PROJECT_ID=tu-project-id
GCP_LOCATION=global
VERTEX_MODEL=gemini-4-hydrogen
GCP_SERVICE_ACCOUNT_JSON=<JSON en una sola línea o codificado en Base64>
```

```bash
# 3. Levantar en modo desarrollo
npm run dev
# Abrir http://localhost:3000
```

### Scripts disponibles
- `npm run dev`: servidor de desarrollo Next.js.
- `npm run typecheck`: verificación estricta de TypeScript (`tsc --noEmit`).
- `npm run build`: compilación de producción (`next build`).
- `npm run spike:bpmn`: prueba determinista de 3 fixtures con `bpmn-moddle` + `bpmn-auto-layout`.

---

## Arquitectura y documentación de diseño
- **Consigna y requisitos**: [docs/brief/challenge.md](docs/brief/challenge.md), [docs/requirements/wbs.md](docs/requirements/wbs.md), [docs/requirements/user-stories.md](docs/requirements/user-stories.md).
- **Decisiones técnicas (ADRs)**:
  - [ADR-001](docs/architecture/decisions/ADR-001-bpmn-strategy.md): BPMN 2.0 XML semántico + `bpmn-auto-layout`.
  - [ADR-002](docs/architecture/decisions/ADR-002-stack-and-hosting.md): Next.js (App Router, TypeScript) en Vercel Hobby (\$0).
  - [ADR-003](docs/architecture/decisions/ADR-003-llm-provider-adapter.md): Vertex AI en GCP vía `ResilientLlmAdapter` (fallback en P1).
  - [ADR-004](docs/architecture/decisions/ADR-004-no-embeddings-rag-mvp.md): Descarte explícito de Embeddings/RAG en MVP.
- **Bitácora de incidentes y aprendizajes**: [docs/defense/issues-and-lessons.md](docs/defense/issues-and-lessons.md).
- **Roadmap futuro**: [docs/roadmap-future.md](docs/roadmap-future.md).

---

## Limitaciones conocidas del MVP
- **Subconjunto BPMN 2.0**: soporta diagramas de proceso (`<bpmn:process>`: *StartEvent, EndEvent, Task/UserTask/ServiceTask, ExclusiveGateway, ParallelGateway, SequenceFlow*); Pools/Lanes y Colaboraciones quedan fuera del MVP.
- **Layout en bucles múltiples**: `bpmn-auto-layout` v1.x usa un flujo horizontal de fila única y puede superponer líneas de retorno en procesos con varios bucles consecutivos (ajustable manualmente en el editor).
- **Rate limiting sin DB**: el límite por IP es *in-memory* por instancia serverless (en producción se migraría a Redis).
- **Cuota RPM en GCP Free Trial**: proyectos nuevos de GCP pueden aplicar límites estrictos por minuto (DSQ), devolviendo `429` ante ráfagas seguidas.
