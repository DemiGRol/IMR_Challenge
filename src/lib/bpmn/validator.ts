import { layoutProcess } from 'bpmn-auto-layout';
import BpmnModdle from 'bpmn-moddle';

const MAX_XML_BYTES = 200 * 1024;
const FORBIDDEN_PATTERNS = [
  /<!DOCTYPE/i,
  /<!ENTITY/i,
  /<script\b/i,
  /javascript:/i,
  /\bon[a-z]+\s*=/i,
];

const ALLOWED_FLOW_TYPES = new Set([
  'bpmn:StartEvent',
  'bpmn:EndEvent',
  'bpmn:Task',
  'bpmn:UserTask',
  'bpmn:ServiceTask',
  'bpmn:ExclusiveGateway',
  'bpmn:ParallelGateway',
  'bpmn:SequenceFlow',
]);

interface ModdleFlowElement {
  $type: string;
  id?: string;
  incoming?: unknown[];
  outgoing?: unknown[];
  sourceRef?: { id?: string };
  targetRef?: { id?: string };
}

interface ModdleProcess {
  $type: string;
  flowElements?: ModdleFlowElement[];
}

interface ModdleDefinitions {
  rootElements?: ModdleProcess[];
}

export class BpmnValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BpmnValidationError';
  }
}

export async function validateAndLayoutBpmn(rawXml: string): Promise<string> {
  const xml = rawXml.replace(/^```xml\s*/i, '').replace(/\s*```$/i, '').trim();

  if (Buffer.byteLength(xml, 'utf8') > MAX_XML_BYTES) {
    throw new BpmnValidationError('El XML BPMN generado excede el tamaño máximo permitido.');
  }

  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(xml)) {
      throw new BpmnValidationError('El XML generado contiene directivas o etiquetas no permitidas.');
    }
  }

  const moddle = new BpmnModdle();
  let rootElement: ModdleDefinitions;
  try {
    const parsed = await moddle.fromXML(xml);
    if (parsed.warnings && parsed.warnings.length > 0) {
      throw new BpmnValidationError(
        'El XML BPMN contiene elementos desconocidos o referencias sin resolver.'
      );
    }
    rootElement = parsed.rootElement as unknown as ModdleDefinitions;
  } catch (err) {
    if (err instanceof BpmnValidationError) throw err;
    throw new BpmnValidationError('El XML devuelto por el modelo no es BPMN 2.0 válido.');
  }

  const rootElements = rootElement.rootElements || [];
  if (rootElements.some((el) => el.$type === 'bpmn:Collaboration')) {
    throw new BpmnValidationError(
      'El MVP solo soporta diagramas de proceso (<bpmn:process>), sin colaboraciones ni pools.'
    );
  }

  const processes = rootElements.filter((el) => el.$type === 'bpmn:Process');
  if (processes.length === 0) {
    throw new BpmnValidationError('El BPMN generado no contiene ningún elemento <bpmn:process>.');
  }

  const flowElements = processes[0].flowElements || [];
  const allIds = new Set<string>();
  const flowNodeIds = new Set<string>();

  for (const el of flowElements) {
    if (!ALLOWED_FLOW_TYPES.has(el.$type)) {
      throw new BpmnValidationError(
        `El proceso contiene un elemento fuera del subconjunto MVP: ${el.$type}.`
      );
    }
    if (!el.id) {
      throw new BpmnValidationError('Todos los elementos BPMN deben tener un atributo id.');
    }
    if (allIds.has(el.id)) {
      throw new BpmnValidationError(`Se detectó un id BPMN duplicado: ${el.id}.`);
    }
    allIds.add(el.id);
    if (el.$type !== 'bpmn:SequenceFlow') {
      flowNodeIds.add(el.id);
    }
  }

  const starts = flowElements.filter((el) => el.$type === 'bpmn:StartEvent');
  const ends = flowElements.filter((el) => el.$type === 'bpmn:EndEvent');
  if (starts.length === 0 || ends.length === 0) {
    throw new BpmnValidationError(
      'El proceso generado debe incluir al menos un evento de inicio y uno de fin.'
    );
  }

  const flows = flowElements.filter((el) => el.$type === 'bpmn:SequenceFlow');
  for (const flow of flows) {
    const src = flow.sourceRef?.id;
    const tgt = flow.targetRef?.id;
    if (!src || !tgt || !flowNodeIds.has(src) || !flowNodeIds.has(tgt)) {
      throw new BpmnValidationError(
        `El flujo de secuencia ${flow.id} tiene sourceRef o targetRef inválido.`
      );
    }
  }

  let layoutedXml: string;
  try {
    layoutedXml = await layoutProcess(xml);
  } catch {
    throw new BpmnValidationError(
      'No se pudo calcular el layout visual del diagrama BPMN generado.'
    );
  }

  if (
    !layoutedXml.includes('BPMNDiagram') ||
    !layoutedXml.includes('BPMNPlane') ||
    !layoutedXml.includes('BPMNShape') ||
    !layoutedXml.includes('BPMNEdge')
  ) {
    throw new BpmnValidationError('El layout BPMN no generó correctamente el bloque DI.');
  }

  return layoutedXml;
}
