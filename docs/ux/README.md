# UX/UI — Diseño e Interacción (`as-built` · `v0.7.5`)

- **Estado**: `as-built` (`v0.7.5`, verificado tras auditoría UX/UI el `26/11/2026`).
- **Alcance**: especificación real de interfaz, recorridos, accesibilidad y controles sobre `bpmn-js@18` en [page.tsx](../../src/app/page.tsx), [BpmnEditor.tsx](../../src/components/BpmnEditor.tsx), [ProductTour.tsx](../../src/components/ProductTour.tsx) y [globals.css](../../src/app/globals.css).

---

## 1. Arquitectura de pantalla y modelo mental
- **Estructura en 3 zonas**:
  1. **Header superior**: botón de colapso de panel, marca, stepper de flujo en 3 pasos (**1. Describir → 2. Modelar → 3. Auditar** con `aria-current="step"`), badge de estado en vivo (*Sin diagrama / Generado por IA / Editado manualmente / Lienzo en blanco / Importado*), botón **Guía** (`ProductTour`), selector tipográfico (`A A A`: chico `15px`, mediano `17px`, grande `19px`), toggle **Modo claro / oscuro** con View Transitions + script anti-FOUC (`layout.tsx`), y **Nuevo en blanco**.
  2. **Sidebar izquierdo redimensionable** (`380px` inicial con `resize-handle`): solapas **Descripción** (textarea `10–4.000` chars con contador, botón **Limpiar**, 4 chips de ejemplo, selector de modo `Rápido` / `Detallado`, botón contextual *Generar / Refinar conservando ediciones* + *Regenerar desde cero*) y **Supuestos** (tarjetas por impacto `high`/`medium`/`low`, recomendaciones BPMN, extracto resaltado, *Marcar como resuelto* / *Reabrir* y *Re-analizar diagrama actual*).
  3. **Lienzo BPMN (`bpmn-js@18`)**: barra de herramientas de undo/redo, zoom (`+`, `-`, `%`, ajustar), visor de **XML en vivo**, **Importar `.bpmn`**, **Descargar `.bpmn` / `.svg`** y paleta BPMN completa.

---

## 2. Interacciones avanzadas y resiliencia de sesión
- **Trazabilidad bidireccional supuestos ↔ diagrama**: al seleccionar una tarjeta de supuesto o recomendación se enfocan suavemente (`scrollToElement`) y resaltan los nodos afectados en el canvas; al hacer clic en un nodo marcado en el canvas se selecciona la tarjeta asociada.
- **Edición avanzada sin romper flujos**:
  - **Multiselección (`Ctrl / Cmd + clic`)**: permite arrastrar bloques de elementos en conjunto adaptando los flujos externos automáticamente.
  - **Reordenamiento de `BoundaryEvent`**: al seleccionar una actividad con >= 2 eventos adjuntos (o uno de ellos), aparece una barra contextual anclada encima/debajo para intercambiar su posición (`swap`) recalculando sus flujos.
- **Autoguardado y control de espera**: cada mutación del `commandStack` (`diagramRevision`) sincroniza el borrador en `localStorage` (`imr_session_draft_v1`, debounce `600 ms`); durante la generación se muestra barra de progreso por fases y botón **Cancelar** (`AbortController`).

---

## 3. Accesibilidad y Responsive
- **Responsive**: breakpoint desktop compacto (`<= 1240px` con `flex-wrap`) y móvil/tablet (`<= 900px` con `height: 100dvh`, barra de herramientas deslizable y ocultado de etiquetas secundarias en stepper conservando `aria-label`).
- **Accesibilidad y diálogos (`v0.7.2`–`v0.7.5`)**: teclado aislado dentro de `.bpmn-container` (`:focus-visible`), modales `ConfirmDialog` propios (`role="alertdialog"`, foco inicial en *Seguir editando*, cierre con `Escape`) en reemplazo de `window.confirm`, soporte de teclado en tarjetas de supuestos (`e.target === e.currentTarget`, `aria-expanded`), overlay `importError` con `role="alert"` y botón **Cerrar**, contraste AA en `.primary-btn` en modo oscuro y guía interactiva (`ProductTour`) de 5 pasos con `scrollIntoView`.
