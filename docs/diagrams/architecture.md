# Arquitectura de Alto Nivel — Contenedores (C4 Nivel 2)

- **Estado**: `as-built` (`v0.7.3`, verificado el `26/11/2026`).
- **Propósito**: explicar los grandes bloques constructivos del sistema y cómo se comunican entre sí en lenguaje accesible para perfiles técnicos y de negocio.
- **Detalle técnico (contratos, rutas y esquemas)**: ver [contracts.md](../architecture/contracts.md) y [architecture/README.md](../architecture/README.md).
- **Decisiones vinculadas**: [ADR-001](../architecture/decisions/ADR-001-bpmn-strategy.md), [ADR-002](../architecture/decisions/ADR-002-stack-and-hosting.md), [ADR-003](../architecture/decisions/ADR-003-llm-provider-adapter.md), [ADR-005](../architecture/decisions/ADR-005-tiered-llm-fallback.md), [ADR-006](../architecture/decisions/ADR-006-collaboration-and-events.md).

```mermaid
flowchart LR
    User["Analista / Usuario\n(Navegador Web)"]

    subgraph Sys["IMR BPMN Studio (Sistema Web)"]
        Web["Aplicación Web y Editor Visual\n(Describe procesos, audita supuestos\ny edita diagramas BPMN)"]
        LocalStore[("Almacenamiento Local\ndel Navegador\n(Borrador y preferencias)")]
        Backend["Servicio de Orquestación\ny Control\n(Límites de uso, caché y métricas)"]
        Adapter["Adaptador de Inteligencia\nArtificial\n(Unifica proveedores y contingencias)"]
        BpmnEngine["Motor de Validación\ny Diseño BPMN\n(Valida reglas y ordena el dibujo)"]

        Web <--> |"Guarda y recupera\nel trabajo en curso"| LocalStore
        Web -- "Solicita generar, refinar\no auditar diagrama" --> Backend
        Backend -- "Pide interpretar el proceso\no auditar supuestos" --> Adapter
        Backend -- "Pide validar reglas\ny calcular distribución visual" --> BpmnEngine
    end

    ExtPrimary["Servicio de IA Primario\n(Google Cloud Vertex AI)"]
    ExtBackup["Servicio de IA de Respaldo\n(Google AI Studio)"]

    User -- "Ingresa texto, revisa supuestos,\nedita y descarga" --> Web
    Adapter -- "Envía descripción o diagrama\ny recibe estructura" --> ExtPrimary
    Adapter -. "Activa respaldo automático\nante fallas o demoras" .-> ExtBackup
```

### Leyenda
- **Cajas dentro del recuadro**: bloques lógicos que conforman la aplicación (interfaz, almacenamiento en navegador, orquestación, adaptador de IA y motor BPMN).
- **Flecha continua**: flujo habitual de operación.
- **Flecha punteada**: ruta de contingencia para mantener la disponibilidad del servicio.
