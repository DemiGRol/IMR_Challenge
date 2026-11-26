# Diagramas de Secuencia — Flujos Principales

- **Estado**: `as-built` (`v0.7.3`, verificado el `26/11/2026`).
- **Propósito**: describir paso a paso, de arriba hacia abajo, cómo colaboran las partes principales del sistema para cumplir los dos casos de uso centrales sin entrar en detalle de clases o código.

## Flujo A — Generar o refinar un diagrama desde texto

```mermaid
sequenceDiagram
    actor U as Usuario
    participant Web as Aplicación Web
    participant Srv as Servidor de la Aplicación
    participant IA as Servicio de IA
    participant Motor as Motor de Diagramado BPMN

    U->>Web: Escribe descripción del proceso o pide refinar sus cambios
    Web->>Srv: Envía descripción y borrador previo si hubo ediciones
    Srv->>Srv: Verifica límites de uso y resultados previos guardados

    alt Resultado previo válido sin cambios manuales
        Srv-->>Web: Devuelve diagrama y supuestos al instante
    else Requiere nueva interpretación
        Srv->>IA: Solicita interpretar el proceso en estructura BPMN y supuestos
        Note right of IA: Si el proveedor primario falla o tarda, deriva automáticamente al servicio de respaldo
        IA-->>Srv: Devuelve estructura del proceso y supuestos

        Srv->>Motor: Valida reglas del estándar y calcula la ubicación visual

        opt Detecta error estructural en la primera respuesta
            Motor-->>Srv: Indica el error encontrado
            Srv->>IA: Solicita una corrección automática puntual
            IA-->>Srv: Devuelve estructura corregida
            Srv->>Motor: Revalida reglas y calcula la ubicación visual
        end

        Motor-->>Srv: Entrega diagrama válido listo para dibujar
        Srv-->>Web: Envía diagrama editable, supuestos y recomendaciones
    end

    Web-->>U: Muestra el diagrama interactivo y resalta supuestos para auditar
```

## Flujo B — Auditar supuestos sin alterar el dibujo actual

```mermaid
sequenceDiagram
    actor U as Usuario
    participant Web as Aplicación Web
    participant Srv as Servidor de la Aplicación
    participant IA as Servicio de IA

    U->>Web: Solicita re-analizar el diagrama visible
    Web->>Srv: Envía diagrama actual y lista de supuestos ya resueltos
    Srv->>Srv: Verifica límites de uso y prepara contexto compacto
    Srv->>IA: Pide detectar nuevas ambigüedades y buenas prácticas BPMN
    IA-->>Srv: Devuelve supuestos pendientes y recomendaciones
    Srv-->>Web: Envía resultado de la auditoría
    Web-->>U: Actualiza el panel de supuestos manteniendo intacto el dibujo
```

### Cómo leer estos diagramas
- El tiempo transcurre siempre **de arriba hacia abajo**.
- Los recuadros **`alt`** muestran caminos alternativos (por ejemplo, reutilizar un resultado previo vs. consultar a la IA); **`opt`** indica un paso opcional que solo ocurre ante errores.
