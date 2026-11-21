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

interface ModdleFlowElement {
  $type: string;
  id?: string;
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
    rootElement = parsed.rootElement as unknown as ModdleDefinitions;
  } catch {
    throw new BpmnValidationError('El XML devuelto por el modelo no es BPMN 2.0 válido.');
  }

  const processes = (rootElement.rootElements || []).filter(
    (el) => el.$type === 'bpmn:Process'
  );
  if (processes.length === 0) {
    throw new BpmnValidationError('El BPMN generado no contiene ningún elemento <bpmn:process>.');
  }

  const flowElements = processes[0].flowElements || [];
  const hasStart = flowElements.some((el) => el.$type === 'bpmn:StartEvent');
  const hasEnd = flowElements.some((el) => el.$type === 'bpmn:EndEvent');
  if (!hasStart || !hasEnd) {
    throw new BpmnValidationError(
      'El proceso generado debe incluir al menos un evento de inicio y uno de fin.'
    );
  }

  const nodeIds = new Set(
    flowElements.filter((el) => el.id).map((el) => el.id as string)
  );
  const flows = flowElements.filter((el) => el.$type === 'bpmn:SequenceFlow');
  for (const flow of flows) {
    const src = flow.sourceRef?.id;
    const tgt = flow.targetRef?.id;
    if (!src || !tgt || !nodeIds.has(src) || !nodeIds.has(tgt)) {
      throw new BpmnValidationError(
        'El proceso generado contiene flujos de secuencia con referencias inválidas.'
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

  if (!layoutedXml.includes('BPMNDiagram') || !layoutedXml.includes('BPMNPlane')) {
    throw new BpmnValidationError('El layout BPMN no generó el bloque Diagram Interchange (DI).');
  }

  return layoutedXml;
}
