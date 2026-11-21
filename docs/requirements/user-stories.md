# Historias de Usuario y Criterios de Aceptación (T-02)

- **Estado**: aprobado (derivadas de [wbs.md](wbs.md) y [IMR.drawio](../diagrams/IMR.drawio)).
- **Subconjunto BPMN 2.0 del MVP**: Diagrama de **Proceso** (`<bpmn:process>`: *StartEvent, EndEvent, Task/UserTask/ServiceTask, ExclusiveGateway, ParallelGateway, SequenceFlow*). Pools/Lanes y Colaboración fuera del MVP.

---

## Historias de Usuario (MVP — P0)

### US-01 — Describir proceso o elegir ejemplo precargado (`REQ-01` | WBS `2.1`, `2.2`)
**Como** analista de proceso, **quiero** escribir/pegar la descripción de un proceso en lenguaje natural o elegir un ejemplo precargado, **para** generar su diagrama BPMN sin redactar XML.
- **CA-01.1**: Dado que ingreso un texto entre 10 y 4.000 caracteres y presiono "Generar", se inicia la solicitud de generación.
- **CA-01.2**: Si el campo está vacío o supera el límite, la UI bloquea el envío y muestra validación clara.
- **CA-01.3**: Al elegir cualquiera de los 2–3 ejemplos precargados, el campo se completa listo para generar.

### US-02 — Generar sintaxis BPMN 2.0 vía LLM Adapter con fallback (`REQ-02`, `REQ-03` | WBS `3.1`, `3.2`)
**Como** analista de proceso, **quiero** que el backend invoque al LLM configurado y devuelva sintaxis BPMN 2.0 (junto con supuestos si el texto es ambiguo), **para** obtener el modelo de forma segura y resiliente.
- **CA-02.1**: Las credenciales LLM viven exclusivamente en servidor (nunca en navegador ni respuestas HTTP).
- **CA-02.2**: Ante falla o timeout del proveedor primario, el **LLM Adapter** intenta el proveedor de fallback configurado antes de devolver error.
- **CA-02.3**: Ante abuso o exceso de solicitudes, el backend responde `429` (rate limit) con mensaje sanitizado.

### US-03 — Procesar, validar y visualizar BPMN 2.0 legible en `bpmn.io` (`REQ-04`, `REQ-05` | WBS `3.3`, `4.1`)
**Como** analista de proceso, **quiero** que la sintaxis BPMN devuelta se valide y se disponga con layout automático limpio en `bpmn.io`, **para** entender el diagrama sin superposiciones ni errores `no diagram to display`.
- **CA-03.1**: Un BPMN 2.0 válido se importa y renderiza en `bpmn-js` sin errores.
- **CA-03.2**: Al finalizar el renderizado, la vista se ajusta automáticamente (`fit-viewport`) con layout legible.

### US-04 — Navegar y editar el diagrama interactivamente (`REQ-05` | WBS `4.2`, `4.3`)
**Como** analista de proceso, **quiero** navegar y editar el diagrama directamente en `bpmn.io`, **para** ajustar etiquetas, pasos o flujos.
- **CA-04.1**: Puedo editar etiquetas, mover nodos, agregar/eliminar elementos y reconectar flujos desde la paleta de `bpmn-js` Modeler.
- **CA-04.2**: Puedo usar controles de zoom (+ / - / centrar) y deshacer/rehacer.

### US-05 — Ver estado de carga, errores, supuestos y reintentar (`REQ-05` | WBS `5.1`, `5.2`, `5.3`)
**Como** analista de proceso, **quiero** ver el estado de carga, recibir alertas claras de errores o supuestos asumidos y poder reintentar, **para** operar con transparencia.
- **CA-05.1**: Durante la generación se muestra indicador de carga y se bloquean envíos duplicados.
- **CA-05.2**: Ante error de red, timeout, rate limit o XML inválido, se muestra alerta comprensible con botón de reintento conservando el texto ingresado.
- **CA-05.3**: Si el LLM detecta ambigüedades y asume supuestos, la UI los muestra en una alerta/panel visible sin bloquear el diagrama.

### US-06 — Acceder vía URL pública y descargar `.bpmn`/`.svg` (`REQ-06`, `REQ-05` | WBS `6.1`, `6.2`)
**Como** evaluador o analista, **quiero** acceder a la app mediante URL pública HTTPS y descargar el diagrama editado en `.bpmn` o `.svg`, **para** probarla sin fricción y reutilizar el resultado.
- **CA-06.1**: La aplicación funciona en URL pública HTTPS sobre infraestructura gratuita y es reproducible localmente siguiendo `README.md` y `.env.example`.
- **CA-06.2**: Los botones de descarga generan archivos `.bpmn` (XML válido con ediciones actuales) y `.svg` descargables desde el navegador.

---

## Historias Deseables (P1 — Si queda margen)
- **US-07 (WBS `5.4`)**: Solicitar confirmación antes de sobrescribir ediciones manuales al generar un nuevo diagrama.
- **US-08 (WBS `6.3`)**: Abrir un panel colapsable para inspeccionar/copiar el XML BPMN 2.0 actual.

---

## Requisitos No Funcionales (NFR)
- **NFR-01 (Seguridad)**: API keys solo en servidor; validación/sanitización de XML (sin XXE ni HTML arbitrario); entrada tratada como datos.
- **NFR-02 (Cuota/Abuso)**: Rate limiting por IP, límite de 4.000 caracteres y timeout acotado (20–30 s).
- **NFR-03 (Extensibilidad)**: Patrón **LLM Adapter** desacoplado con fallback configurable.
