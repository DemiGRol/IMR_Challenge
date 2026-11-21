# WBS — Work Breakdown Structure (derivada del USM)

- **Estado**: aprobado (alineado con [IMR.drawio](../diagrams/IMR.drawio) — pestaña `USM`).
- **Base**: [challenge.md](../brief/challenge.md) (`REQ-01`–`REQ-06`), esfuerzo total 10–15 h.

## 1.0 Diseño y Base Técnica (Transversal)
- `1.1` Comparativa técnica y ADRs (estrategia BPMN 2.0, LLM Adapter + fallback, evaluación de embeddings, stack y hosting gratuito) → `T-03`
- `1.2` Spike temprano (`texto → LLM → BPMN → bpmn-js editable`) → `T-04`
- `1.3` Setup del proyecto (frontend + backend proxy, `.env.example`, rate limiting básico) → `T-05`

## 2.0 Describir Proceso (`Describir`)
- `2.1` Formulario de ingreso/pegado de texto libre con validación de longitud y disparo de generación *(P0 — `US-01`)*
- `2.2` Selector de 2–3 ejemplos precargados de procesos de negocio *(P0 — `US-01`)*

## 3.0 Generación BPMN y Motor LLM (`Core Backend`)
- `3.1` Prompt estructurado BPMN 2.0 + extracción de supuestos/advertencias *(P0 — `US-02`, `US-05`)*
- `3.2` **LLM Adapter** (proveedor primario Google/GCP + mecanismo de fallback configurable) *(P0 — `US-02`)*
- `3.3` Validación estructural XML BPMN 2.0 y auto-layout DI *(P0 — `US-03`)*

## 4.0 Visualización y Edición (`Visualizar`)
- `4.1` Integración de `bpmn-js` Modeler y renderizado dinámico *(P0 — `US-03`)*
- `4.2` Controles de navegación: zoom, centrar/ajustar vista, deshacer/rehacer *(P0 — `US-04`)*
- `4.3` Edición interactiva de elementos, etiquetas y flujos *(P0 — `US-04`)*

## 5.0 Validación, Feedback y Recuperación (`Validar`)
- `5.1` Indicador de estado de carga y prevención de envíos duplicados *(P0 — `US-05`)*
- `5.2` Alertas claras de errores de generación + botón de reintento sin perder el texto *(P0 — `US-05`)*
- `5.3` Alerta/panel de supuestos asumidos en la descripción del proceso *(P0 — `US-05`)*
- `5.4` Confirmación para proteger cambios manuales ante una nueva generación *(P1 — `US-07`)*

## 6.0 Compartir y Exportar (`Compartir/Exportar`)
- `6.1` Despliegue público HTTPS en tier gratuito + ejecución local reproducible (`README.md`) *(P0 — `US-06`)*
- `6.2` Descarga del diagrama editado en formato `.bpmn` y `.svg` *(P0 — `US-06`)*
- `6.3` Panel colapsable para inspeccionar/copiar el XML BPMN generado *(P1 — `US-08`)*

## 7.0 Calidad y Defensa
- `7.1` Pruebas con escenarios variados, validación de seguridad/XML y revisión independiente → `T-06`
- `7.2` Entrega reproducible, evidencia final, guion de defensa de 30 min y ensayo de demo → `T-07`, `T-08`
