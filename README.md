# IMR — Agentic development starter
Plantilla inicial de trabajo para el desafío de BPMN. No es el código fuente de la aplicación ni un proyecto ejecutable. No impone stack.

## Arranque
1. Extraé el ZIP en una carpeta nueva, conservando `.agents/` y archivos ocultos. Abrí la raíz como workspace de Antigravity. No publiques el contenido ni subas el correo original con datos privados.
2. Comprobá que Antigravity detecta AGENTS.md, skills y custom agents mediante Customizations. Si no los carga, pedí lectura explícita de los archivos. Las prestaciones de delegación dependen de superficie, versión, cuenta y plan. No se han probado en tu instalación.
3. Abrí un chat principal, seleccioná Gemini 4 Neon con razonamiento Low si está disponible y pegá el contenido de COORDINATOR.md, o pedí leerlo completo y adoptarlo como instrucciones de sesión. El archivo no reemplaza las instrucciones de sistema propias del IDE. No lo cargues como regla global para otros proyectos o especialistas. Los niveles y modelos de los especialistas se eligen por tarea según §5.1; el YAML conserva `model: inherit` para no fijar IDs de modelo ni asumir compatibilidad. Verificá la configuración efectiva de cada delegación o usá sesiones manuales si es necesario.
4. Enviá: «Leé COORDINATOR.md completo, AGENTS.md, .agents/CONTEXT.md, docs/brief/challenge.md y docs/backlog.md. Adoptá las instrucciones del coordinador e iniciá la sección 11 en modo planificación, considerando mi plan Google AI Pro y la política de cuota de la sección 5.1. No implementes ni instales dependencias todavía». Revisá y aprobá el primer plan.
5. Según el diseño elegido, creá src/ o frontend/backend, tests, package manager, .env.example y contratos. Este starter no instala dependencias ni realiza llamadas LLM. Confirmá reglas de IMR sobre asistencia de IA si existe duda.

## Antes de desarrollar
- Confirmar si IMR tiene condiciones sobre asistencia con IA que no figuran en la consigna; usar una de las tres consultas solo si corresponde. No ocultar el uso de agentes en la defensa.
- Definir tiempo efectivo de trabajo y presupuesto de la API runtime; no confundirlo con la cuota del IDE. Confirmar credenciales de prueba cuando se elija proveedor, sin compartir claves en el chat ni en archivos versionados.
- Comprobar permisos de herramientas, ejecución, publicación y edición de archivos en el IDE. Verificar el estado de Git y acordar política de commits antes del primer cambio de implementación; no publicar automáticamente.
- El coordinador debe priorizar un flujo vertical funcional temprano y adaptar la planificación a la cuota observada; no iniciar simultáneamente todos los especialistas ni cargar documentos irrelevantes.

## Fuentes de funcionamiento de Antigravity y BPMN
- https://antigravity.google/docs/customization-discovery
- https://antigravity.google/docs/subagents
- https://antigravity.google/docs/skills
- https://bpmn.io/toolkit/bpmn-js/walkthrough/
Consultadas el 20/11/2026. Verificar la versión y el plan antes de usar herramientas de delegación. Los roles usan frontmatter mínimo; commandExecutionPolicy no sustituye una restricción efectiva de herramientas. Configurar allowlists/permission prompts en el entorno real antes de delegar.

## Contenido
- COORDINATOR.md: prompt principal de sesión.
- AGENTS.md: reglas compartidas permanentes.
- .agents/agents/: especialistas reutilizables; cada uno puede usarse como prompt manual si no hay subagentes.
- .agents/skills/: procedimientos bajo demanda.
- .agents/CONTEXT.md y handoffs/: memoria durable y delegaciones.
- docs/: brief, discovery, requisitos, arquitectura, diagramas, UX, calidad, defensa, backlog.

Separar documentos internos de la entrega. No incluir historial privado, secretos, correo original ni artefactos temporales. Antes de entregar, revisar archivos y adaptar README a los comandos reales del producto.
