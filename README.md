# IMR BPMN Studio — Generador de Procesos BPMN 2.0 (`v0.7.4`)

Aplicación web que transforma descripciones textuales de procesos de negocio en diagramas **BPMN 2.0** válidos, legibles y editables interactivamente mediante **bpmn.io (`bpmn-js`)**, impulsada por **Vertex AI (GCP)** a través de un patrón **LLM Adapter** con fallback resiliente.

> **Demo en vivo (Vercel):** https://imr-challenge.vercel.app/

---

## Características implementadas (`v0.7.4`)
- **Descripción en lenguaje natural** (10–4.000 caracteres) con 4 ejemplos precargados (lineal, decisión XOR, paralelismo AND y colaboración con eventos).
- **Modos de generación `Rápido` (predeterminado) y `Detallado`** vía **Vertex AI (`gemini-4-hydrogen` en `global`)** con fallback a **Google AI Studio** (`ResilientLlmAdapter` con *deadline* compartido), Structured Outputs (`{ bpmnXml, assumptions, recommendations }`) y hasta 1 reintento automático de auto-reparación.
- **Cobertura BPMN 2.0 ampliada y layouter determinista generalizado**:
  - Colaboraciones con **Pools** (*white-box* y *black-box* ordenados automáticamente arriba/abajo según carriles conectados), **Lanes** y **MessageFlows** con evasión de obstáculos.
  - Eventos de inicio, intermedios y fin tipados (`Message`, `Timer`, `Escalation`, `Error`), **Boundary Events** interruptivos y no interruptivos, compuertas `Exclusive`, `Parallel`, `Inclusive` (con flujo `default`) y `EventBased`, tareas especializadas y marcadores de bucle/multi-instancia.
  - Puertos diferenciados en **salidas y entradas** de compuertas, autopistas perimetrales para saltos largos, canales superiores para retornos y separación de carriles superpuestos.
- **Auditoría e iteración *human-in-the-loop***: supuestos estructurados por impacto con resaltado bidireccional en el lienzo, seguimiento (*Marcar como resuelto* / *Reabrir*), recomendaciones técnicas BPMN, re-análisis en vivo sin sobrescribir el dibujo (`POST /api/analyze-bpmn`) y refinamiento conservando ediciones manuales (`preserve-edits`).
- **UI/UX renovada y editor `bpmn-js` avanzado**:
  - Encabezado con flujo en 3 pasos (*Describir → Modelar → Auditar*), **modo claro/oscuro** con transición animada y estilado SVG nativo para `bpmn-js`, selector de tamaño de texto (`A A A` chico/mediano/grande) y **Product Tour** interactivo de 5 pasos.
  - Barra contextual anclada sobre actividades con múltiples eventos adjuntos para reordenarlos adaptando sus flujos, multiselección con **`Ctrl / Cmd + clic`** para mover bloques con ajuste automático de flujos externos, halo cartográfico en etiquetas, autoguardado local en navegador, cancelación cooperativa de generación, importación/exportación **`.bpmn`** (multi-prefijo) / **`.svg`** e inspector XML.
- **Seguridad y observabilidad**: validación `NCName` de identificadores XML y re-verificación post-layout, headers HTTP de seguridad, rate limiting por IP con protección anti-spoofing y cota en memoria, telemetría estructurada con estimación de costos USD y dashboard unificado ([dashboard.html](docs/quality/benchmark/dashboard.html) + `GET /api/telemetry` protegido en Vercel).

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
- `npm test`: suite de pruebas unitarias (`node --test --experimental-strip-types tests/core.test.ts`, 35 tests).
- `npm run typecheck`: verificación estricta de TypeScript (`tsc --noEmit`).
- `npm run build`: compilación de producción (`next build`).
- `npm run benchmark`: corrida comparativa de modos (`-- --report-only` regenera el dashboard HTML con las corridas locales).
- `npm run spike:bpmn`: prueba determinista de fixtures con `bpmn-moddle` + `bpmn-auto-layout`.

---

## Arquitectura y documentación de diseño
- **Consigna y requisitos**: [docs/brief/challenge.md](docs/brief/challenge.md), [docs/requirements/wbs.md](docs/requirements/wbs.md), [docs/requirements/user-stories.md](docs/requirements/user-stories.md) y [matriz de trazabilidad](docs/requirements/traceability.md).
- **Arquitectura, contratos y diagramas (`as-built`)**: [docs/architecture/README.md](docs/architecture/README.md), [contracts.md](docs/architecture/contracts.md) y [docs/diagrams/README.md](docs/diagrams/README.md) ([DFD-0](docs/diagrams/dfd-0.md), [Componentes](docs/diagrams/architecture.md), [Secuencia](docs/diagrams/sequence.md), [Estados](docs/diagrams/states.md)).
- **Decisiones técnicas (ADRs)**:
  - [ADR-001](docs/architecture/decisions/ADR-001-bpmn-strategy.md): BPMN 2.0 XML semántico + layout determinista.
  - [ADR-002](docs/architecture/decisions/ADR-002-stack-and-hosting.md): Next.js (App Router, TypeScript) en Vercel Hobby (\$0).
  - [ADR-003](docs/architecture/decisions/ADR-003-llm-provider-adapter.md): Vertex AI en GCP vía `ResilientLlmAdapter`.
  - [ADR-004](docs/architecture/decisions/ADR-004-no-embeddings-rag-mvp.md): Descarte explícito de Embeddings/RAG en MVP.
  - [ADR-005](docs/architecture/decisions/ADR-005-tiered-llm-fallback.md): Estrategia de fallback Vertex AI → Google AI Studio.
  - [ADR-006](docs/architecture/decisions/ADR-006-collaboration-and-events.md): Colaboración BPMN 2.0, eventos y layout de swimlanes.
- **Calidad, UX y benchmark**: [test-plan.md](docs/quality/test-plan.md), [ux/README.md](docs/ux/README.md), [report.md](docs/quality/benchmark/report.md) y [dashboard.html](docs/quality/benchmark/dashboard.html).
- **Bitácora de incidentes y aprendizajes**: [docs/defense/issues-and-lessons.md](docs/defense/issues-and-lessons.md).
- **Roadmap futuro**: [docs/roadmap-future.md](docs/roadmap-future.md).

---

## Limitaciones conocidas (alcance MVP / Serverless)
- **Estado en memoria por instancia**: caché, rate limiting (`checkRateLimit`) y buffer en vivo de telemetría residen en memoria de Node (sin DB); en producción se migrarían a Upstash Redis / Vercel KV y Log Drains.
- **Sin autenticación ni persistencia multi-usuario**: decisión deliberada para demo sin fricción y cero retención de procesos sensibles en servidor.
- **Subconjunto BPMN 2.0**: `SubProcess` y `ComplexGateway` quedan explícitamente fuera del alcance actual para priorizar legibilidad y determinismo geométrico.
- **Cuota RPM/DSQ en GCP Free Trial**: proyectos nuevos de GCP pueden devolver `429` ante ráfagas seguidas (mitigado por el modo `Rápido` por defecto, caché y fallback).
