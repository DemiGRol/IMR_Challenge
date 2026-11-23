import { layoutProcess } from 'bpmn-auto-layout';
import BpmnModdle from 'bpmn-moddle';
import { buildFallbackLayout } from './fallback-layout.ts';
import { separateOverlappingEdges } from './layout-postprocess.ts';

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
  id?: string;
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

export function compactBpmnForPrompt(xml: string): string {
  return xml
    .replace(/<bpmndi:BPMNDiagram[\s\S]*?<\/bpmndi:BPMNDiagram>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+xmlns:(?:bpmndi|dc|di|omgdc|omgdi|bioc|color)="[^"]*"/gi, '')
    .replace(/\s+(?:exporter|exporterVersion)="[^"]*"/gi, '')
    .replace(/>\s+</g, '><')
    .trim()
    .slice(0, 25_000);
}

export function countBpmnStats(xml: string): {
  elementCount: number;
  gatewayCount: number;
  flowCount: number;
} {
  const flowCount = (xml.match(/<bpmn:sequenceFlow\b/g) || []).length;
  const gatewayCount = (xml.match(/<bpmn:(?:exclusive|parallel)Gateway\b/g) || []).length;
  const tasksAndEvents = (
    xml.match(/<bpmn:(?:startEvent|endEvent|task|userTask|serviceTask)\b/g) || []
  ).length;
  return {
    elementCount: tasksAndEvents + gatewayCount,
    gatewayCount,
    flowCount,
  };
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
    const warnings = (parsed.warnings || []) as Array<{ message?: string }>;
    const unresolved = warnings.find((w) =>
      (w.message || '').toLowerCase().includes('unresolved reference')
    );
    if (unresolved) {
      throw new BpmnValidationError(
        `El XML BPMN tiene una referencia sin resolver: ${(unresolved.message || '').slice(0, 120)}`
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

  const processId = processes[0].id || 'Process_1';
  let layoutedXml: string;
  try {
    layoutedXml = separateOverlappingEdges(await layoutProcess(xml));
  } catch (err) {
    console.warn('[validator] bpmn-auto-layout failed, using deterministic fallback layouter', {
      detail: err instanceof Error ? err.message.slice(0, 140) : 'unknown',
    });
    layoutedXml = separateOverlappingEdges(
      buildFallbackLayout(xml, processId, flowElements)
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
