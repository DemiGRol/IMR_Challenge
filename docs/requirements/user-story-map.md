# User Story Map (USM) — IMR BPMN Challenge

- **Estado**: aprobado (sincronizado con fuente visual [IMR.drawio](../diagrams/IMR.drawio) — pestaña `USM`).
- **WBS derivada**: [wbs.md](wbs.md).

## Backbone (4 Etapas — Persona: Analista de Proceso)

| 1. Describir | 2. Visualizar | 3. Validar | 4. Compartir / Exportar |
|---|---|---|---|
| Ingresar descripción del proceso en lenguaje natural | Navegar el modelo / Editar modelo | Recibir errores y supuestos / Regenerar modelo | Compartir modelo / Exportar modelo |

## Corte de Release (sincronizado con `IMR.drawio`)

### MVP — P0
- **Describir**: Escribir/pegar texto del proceso y generar (`US-01`); Elegir un ejemplo precargado (`US-01`).
- **Visualizar**: Navegar (zoom, centrar, deshacer, rehacer) (`US-04`); Editar elementos y etiquetas (`US-04`).
- **Validar**: Ver estado de carga y proceso (`US-05`); Recibir alerta de errores en la generación (`US-05`); Recibir alerta de supuestos en la descripción (`US-05`); Reintentar generación del modelo (`US-05`).
- **Compartir/Exportar**: Acceder vía URL pública (`US-06`); Descargar en formato `.bpmn`/`.svg` (`US-06`).
- **Core Backend (transversal)**: Llamada segura vía LLM Adapter + fallback (`US-02`); Validación y auto-layout BPMN 2.0 (`US-03`).

### Mejoras deseables — P1
- **Validar**: Proteger cambios ante nueva generación (`US-07`).
- **Exportar**: Inspeccionar XML generado (`US-08`).

### Fuera de alcance (Out of Scope)
- Autenticación, Persistencia en BBDD, Chat iterativo multi-turno, Colaboración en tiempo real, Diagramas de Colaboración multi-pool.
