# Investigación de negocio — borrador (T-01)

- **Estado**: propuesto (pendiente de aprobación humana).
- **Origen**: delegación `DEL-01` al especialista `business-analyst` (20/11/2026, 5 búsquedas web enfocadas, solo lectura).
- **Base**: [challenge.md](../brief/challenge.md) (`REQ-01` a `REQ-06`), esfuerzo total 10–15 h, entrega web pública en opciones gratuitas.

## Problema, usuarios y trabajos a realizar

### Hechos verificados sobre por qué fallan las soluciones actuales (consulta 20/11/2026)
1. **Omisión de Diagram Interchange (DI):** los LLM suelen generar la capa semántica (`<bpmn:process>`) pero omiten `<bpmndi:BPMNDiagram>` / `<bpmndi:BPMNPlane>`, provocando el error `no diagram to display` en `bpmn-js` ([camunda.io](https://camunda.io), [arxiv.org](https://arxiv.org)).
2. **Layout ilegible y coordenadas rotas:** al generar coordenadas (`<omgdc:Bounds>`, `<omgdi:waypoint>`) en una sola pasada sin retroalimentación visual, producen cajas superpuestas, etiquetas ilegibles y flujos desconectados ([societybyte.swiss](https://societybyte.swiss)).
3. **XML inválido y desincronización de IDs:** los LLM frecuentemente alucinan atributos `bpmnElement` que no coinciden con IDs semánticos u omiten namespaces XML requeridos por `bpmn.io` (`xmlns:bpmn`, `xmlns:bpmndi`, `xmlns:omgdc`, `xmlns:omgdi`) ([bpmn.io](https://bpmn.io)).
4. **Brecha entre diagramación genérica y estándar BPMN 2.0:** herramientas populares de diagramas (como Lucidchart) permiten dibujar con formas BPMN pero carecen de exportación nativa directa a `.bpmn` XML ([lucid.co](https://lucid.co), [bpmnstudio.com](https://bpmnstudio.com)).
5. **Barreras de acceso y precio en suites BPMN reales:** las capacidades de texto a BPMN en plataformas enterprise suelen estar restringidas a planes pagos/Enterprise o requieren cuentas y workspaces ([thedigitalprojectmanager.com](https://thedigitalprojectmanager.com), [signavio.com](https://signavio.com)).

### Segmentos y trabajos a realizar *(HIPÓTESIS — no validadas con usuarios reales)*
- **Segmento primario (hipótesis):** analistas de negocio, consultores de procesos (perfil afín a IMR Consulting) y product owners que necesitan pasar rápidamente de minutas, correos o procedimientos (SOPs) a un borrador BPMN 2.0 estándar editable para validar con stakeholders.
- **Segmento secundario (hipótesis):** desarrolladores o arquitectos de automatización que necesitan un primer borrador XML BPMN 2.0 válido.
- **Trabajo principal (JTBD, hipótesis):** *"Cuando recibo la descripción textual de un proceso de negocio, quiero convertirla en segundos en un diagrama BPMN 2.0 limpio y editable en el navegador, para poder corregir detalles visualmente y compartirlo sin empezar desde cero ni lidiar con XML roto."*

## Comparación

*Fecha de verificación: 20/11/2026.*

| Producto | Segmento | Entrada | BPMN/XML | Edición | Layout | Exportación | Precio/licencia | Evidencia/fecha | Brecha observada |
|---|---|---|---|---|---|---|---|---|---|
| **Camunda 8 Web Modeler — BPMN Copilot** *(Directo)* | Enterprise / equipos de automatización | Chat en lenguaje natural + iteración conversacional | **Sí (real y ejecutable)** BPMN 2.0 XML nativo | Completa en Web Modeler (`bpmn.io`) | Automático e integrado | `.bpmn` XML nativo | Starter \$0 (hasta 5 usuarios, trial 30 días); Enterprise a medida | [camunda.com](https://camunda.com), [camunda.io](https://camunda.io), [checkthat.ai](https://checkthat.ai) (20/11/2026) | Requiere cuenta/workspace; funciones AI avanzadas ligadas a SaaS/Enterprise. |
| **SAP Signavio — Text to Process** *(Directo)* | Grandes empresas | Texto plano en Process Manager | **Sí (real)** BPMN 2.0 | Completa en Process Manager | Automático | BPMN 2.0 / SAP Build | Cotización Enterprise; trial 30 días | [sap.com](https://sap.com), [signavio.com](https://signavio.com) (20/11/2026) | Alta barrera comercial y administrativa. |
| **ProcessMaker — AI Process Modeler** *(Directo)* | Empresas medianas/grandes (low-code BPM) | Texto o imágenes | **Sí (real)** orientado a ejecución | Completa en su modelador | Automático | Exportación / ejecución en plataforma | Cotización a medida; IA solo en **Enterprise** | [processmaker.com](https://processmaker.com), [thedigitalprojectmanager.com](https://thedigitalprojectmanager.com) (20/11/2026) | IA bloqueada detrás del tier más alto; suite pesada. |
| **Miro AI** *(Indirecto)* | Equipos multidisciplinarios | Prompt de texto (créditos AI) | **Parcial** (formas BPMN; `.bpmn` vía integraciones) | Fluida como pizarra, no estricta en reglas BPMN | Automático básico | Imagen/PDF; `.bpmn` vía apps | Free \$0 (IA limitada); Starter ~\$8/mes; Business ~\$20/mes | [miro.com](https://miro.com), [banani.co](https://banani.co) (20/11/2026) | Prioriza pizarra genérica sobre rigor semántico BPMN 2.0. |
| **Lucidchart AI** *(Indirecto)* | Equipos de negocio / TI | Prompt de texto | **Parcial** (importa `.bpmn`, sin exportación `.bpmn` XML nativa directa) | Muy pulida visualmente | Automático para flowcharts | PNG/PDF/Visio | Free \$0 (limitado); Individual ~\$9/mes | [lucid.co](https://lucid.co), [bpmnstudio.com](https://bpmnstudio.com), [crismo.io](https://crismo.io) (20/11/2026) | No soporta round-trip limpio de BPMN 2.0 XML. |
| **Open-source `bpmn.io` + LLM** (`bpmn-assistant`, `text-to-bpmn2.0`) *(Directo OSS)* | Desarrolladores / prototipos | Texto libre o SOPs | **Sí (real)** XML BPMN 2.0 en `bpmn-js` | Completa en `bpmn-js` Modeler | `bpmn-auto-layout` u otro motor | `.bpmn` XML / SVG | Open-source (requiere hosting propio y API key) | [github.com/jtlicardo/bpmn-assistant](https://github.com/jtlicardo/bpmn-assistant), [github.com/Grade0/text-to-bpmn2.0](https://github.com/Grade0/text-to-bpmn2.0), [github.com/bpmn-io/bpmn-auto-layout](https://github.com/bpmn-io/bpmn-auto-layout) (20/11/2026) | Requiere despliegue técnico propio; UX y robustez variables. |

## Oportunidades / diferenciación
1. **Acceso inmediato sin fricción (zero-login):** frente a suites enterprise con registro/paywall, una web pública directa cumple `REQ-06` y facilita una demo fluida en la entrevista.
2. **Garantía de legibilidad y validez estructural:** atacar directamente la falla #1 del mercado (XML roto o sin DI) asegurando un diagrama siempre renderizable, limpio y editable en `bpmn.io` (`REQ-04`, `REQ-05`).
3. **Edición real en estándar BPMN 2.0 + salida portable:** frente a pizarras genéricas (Miro/Lucidchart), ofrecer edición real con `bpmn-js` Modeler y exportación `.bpmn` estándar.
4. **Transparencia ante fallos o ambigüedades:** estados claros (carga, error recuperable, reintento) en lugar de fallos silenciosos (`no diagram to display`).

## Alcance MVP / fuera de alcance *(Propuesta — pendiente de aprobación humana)*

### Hipótesis de propuesta de valor
*"Una aplicación web ligera y pública que transforma descripciones de procesos de negocio en lenguaje natural en diagramas BPMN 2.0 válidos, legibles y directamente editables en `bpmn.io` en cuestión de segundos, sin registro ni conocimientos previos de XML."*

### MVP — P0 (Imprescindible para 10–15 h)
- Ingreso de texto de proceso + 2–3 ejemplos precargados para demo instantánea (`REQ-01`).
- Generación vía API LLM desde backend protegiendo API key, con validación y rate limiting básico (`REQ-02`, `REQ-03`).
- Procesamiento, validación estructural y layout automático para garantizar renderizado legible (`REQ-04`, `REQ-05`).
- Visualización y edición interactiva en `bpmn.io` Modeler con controles básicos de navegación (zoom, centrar, deshacer/rehacer nativo) (`REQ-04`, `REQ-05`).
- Manejo claro de estados y errores (loading, timeout, error de API o XML inválido con reintento).
- Despliegue web público accesible por URL en tier gratuito (`REQ-06`).

### Deseables — P1 (Solo si queda margen dentro de las 10–15 h)
- Exportación del diagrama editado a `.bpmn` (XML) y/o `.svg` (muy bajo esfuerzo con `bpmn-js`, alto valor en demo).
- Vista/inspección colapsable del XML BPMN generado (evidencia directa de `REQ-03`).
- Botón "Ajustar vista / Centrar".

### Fuera de alcance — P2
- Autenticación, cuentas de usuario y base de datos / historial persistente.
- Chat iterativo multi-turno sobre un diagrama ya editado manualmente.
- Colaboración multiusuario en tiempo real.
- Ejecución en motor BPM o simulación BPSim.
- Soporte completo de elementos avanzados BPMN 2.0 (coreografías, conversaciones, subprocesos colapsados complejos).

## Limitaciones de esta investigación
- Sin pruebas hands-on de plataformas comerciales ni entrevistas con usuarios reales.
- Precios enterprise reportados según fuentes públicas al 20/11/2026.
