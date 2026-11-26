import { layoutProcess } from 'bpmn-auto-layout';
import BpmnModdle from 'bpmn-moddle';
import {
  buildCollaborationLayout,
  type CollabCollaboration,
  type CollabDefinitions,
  type CollabProcess,
} from './collaboration-layout.ts';
import { buildFallbackLayout } from './fallback-layout.ts';
import { separateOverlappingEdges } from './layout-postprocess.ts';

const MAX_XML_BYTES = 200 * 1024;
const NCNAME_REGEX = /^[A-Za-z_][A-Za-z0-9._-]{0,127}$/;
const FORBIDDEN_PATTERNS = [
  /<!DOCTYPE/i,
  /<!ENTITY/i,
  /<script\b/i,
  /javascript:/i,
  /\bon(?:click|dblclick|load|unload|error|abort|mouseover|mouseout|mouseenter|mouseleave|mousedown|mouseup|mousemove|focus|blur|keydown|keyup|keypress|submit|change|input|reset|scroll|resize|contextmenu|drag\w*|drop|touch\w*|pointer\w*|animation\w*|transition\w*)\s*=/i,
];

function assertNoForbiddenPatterns(xml: string): void {
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(xml)) {
      throw new BpmnValidationError('El XML generado contiene directivas o etiquetas no permitidas.');
    }
  }
}

function assertValidId(id: string | undefined, elementLabel: string): string {
  if (!id) {
    throw new BpmnValidationError(`Cada ${elementLabel} debe tener un atributo id.`);
  }
  if (!NCNAME_REGEX.test(id)) {
    throw new BpmnValidationError(
      `El identificador BPMN "${id.slice(0, 40)}" no cumple el formato NCName válido.`
    );
  }
  return id;
}

const ALLOWED_FLOW_TYPES = new Set([
  'bpmn:StartEvent',
  'bpmn:EndEvent',
  'bpmn:IntermediateCatchEvent',
  'bpmn:IntermediateThrowEvent',
  'bpmn:BoundaryEvent',
  'bpmn:Task',
  'bpmn:UserTask',
  'bpmn:ServiceTask',
  'bpmn:SendTask',
  'bpmn:ReceiveTask',
  'bpmn:ManualTask',
  'bpmn:ScriptTask',
  'bpmn:BusinessRuleTask',
  'bpmn:ExclusiveGateway',
  'bpmn:ParallelGateway',
  'bpmn:InclusiveGateway',
  'bpmn:EventBasedGateway',
  'bpmn:SequenceFlow',
]);

const TASK_TYPES = new Set([
  'bpmn:Task',
  'bpmn:UserTask',
  'bpmn:ServiceTask',
  'bpmn:SendTask',
  'bpmn:ReceiveTask',
  'bpmn:ManualTask',
  'bpmn:ScriptTask',
  'bpmn:BusinessRuleTask',
]);

interface ModdleFlowElement {
  $type: string;
  id?: string;
  incoming?: unknown[];
  outgoing?: unknown[];
  sourceRef?: { id?: string };
  targetRef?: { id?: string };
  attachedToRef?: { id?: string };
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
  const seqFlows = (xml.match(/<bpmn:sequenceFlow\b/g) || []).length;
  const msgFlows = (xml.match(/<bpmn:messageFlow\b/g) || []).length;
  const gatewayCount = (
    xml.match(/<bpmn:(?:exclusive|parallel|inclusive|eventBased)Gateway\b/g) || []
  ).length;
  const tasksAndEvents = (
    xml.match(
      /<bpmn:(?:startEvent|endEvent|intermediateCatchEvent|intermediateThrowEvent|boundaryEvent|task|userTask|serviceTask|sendTask|receiveTask|manualTask|scriptTask|businessRuleTask)\b/g
    ) || []
  ).length;
  return {
    elementCount: tasksAndEvents + gatewayCount,
    gatewayCount,
    flowCount: seqFlows + msgFlows,
  };
}

export async function validateAndLayoutBpmn(rawXml: string): Promise<string> {
  const xml = rawXml.replace(/^```xml\s*/i, '').replace(/\s*```$/i, '').trim();

  if (Buffer.byteLength(xml, 'utf8') > MAX_XML_BYTES) {
    throw new BpmnValidationError('El XML BPMN generado excede el tamaño máximo permitido.');
  }

  assertNoForbiddenPatterns(xml);

  const moddle = new BpmnModdle();
  let rootElement: CollabDefinitions;
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
    rootElement = parsed.rootElement as unknown as CollabDefinitions;
  } catch (err) {
    if (err instanceof BpmnValidationError) throw err;
    throw new BpmnValidationError('El XML devuelto por el modelo no es BPMN 2.0 válido.');
  }

  const rootElements = rootElement.rootElements || [];
  const collaboration = rootElements.find(
    (el): el is CollabCollaboration => el.$type === 'bpmn:Collaboration'
  );
  const processes = rootElements.filter(
    (el): el is CollabProcess => el.$type === 'bpmn:Process'
  );

  if (processes.length === 0) {
    throw new BpmnValidationError('El BPMN generado no contiene ningún elemento <bpmn:process>.');
  }

  const allIds = new Set<string>();
  const processById = new Map<string, CollabProcess>();
  const processNodeIds = new Map<string, Set<string>>();
  let nonEmptyProcesses = 0;

  for (const proc of processes) {
    const procId = assertValidId(proc.id, '<bpmn:process>');
    if (allIds.has(procId)) {
      throw new BpmnValidationError(`Se detectó un id BPMN duplicado: ${procId}.`);
    }
    allIds.add(procId);
    processById.set(procId, proc);

    const flowElements = (proc.flowElements || []) as ModdleFlowElement[];
    const flowNodeIds = new Set<string>();
    processNodeIds.set(procId, flowNodeIds);

    if (flowElements.length === 0) {
      continue;
    }
    nonEmptyProcesses += 1;

    const nodeTypeById = new Map<string, string>();
    const boundaryIds = new Set<string>();

    for (const el of flowElements) {
      if (!ALLOWED_FLOW_TYPES.has(el.$type)) {
        throw new BpmnValidationError(
          `El proceso contiene un elemento fuera del subconjunto soportado: ${el.$type}.`
        );
      }
      const elId = assertValidId(el.id, `elemento ${el.$type}`);
      if (allIds.has(elId)) {
        throw new BpmnValidationError(`Se detectó un id BPMN duplicado: ${elId}.`);
      }
      allIds.add(elId);
      if (el.$type !== 'bpmn:SequenceFlow') {
        flowNodeIds.add(elId);
        nodeTypeById.set(elId, el.$type);
        if (el.$type === 'bpmn:BoundaryEvent') {
          boundaryIds.add(elId);
        }
      }
    }

    for (const el of flowElements) {
      if (el.$type === 'bpmn:BoundaryEvent') {
        const hostId = el.attachedToRef?.id;
        const hostType = hostId ? nodeTypeById.get(hostId) : undefined;
        if (!hostId || !hostType || !TASK_TYPES.has(hostType)) {
          throw new BpmnValidationError(
            `El evento de borde ${el.id} debe adjuntarse mediante attachedToRef a una tarea válida del mismo proceso.`
          );
        }
      }
    }

    const starts = flowElements.filter((el) => el.$type === 'bpmn:StartEvent');
    const ends = flowElements.filter((el) => el.$type === 'bpmn:EndEvent');
    if (starts.length === 0 || ends.length === 0) {
      throw new BpmnValidationError(
        `El proceso ${proc.id} debe incluir al menos un evento de inicio y uno de fin.`
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
      if (boundaryIds.has(tgt)) {
        throw new BpmnValidationError(
          `El evento de borde ${tgt} no puede recibir un flujo de secuencia entrante (${flow.id}).`
        );
      }
    }

    for (const laneSet of proc.laneSets || []) {
      if (laneSet.id) {
        assertValidId(laneSet.id, '<bpmn:laneSet>');
        if (allIds.has(laneSet.id)) {
          throw new BpmnValidationError(`Se detectó un id BPMN duplicado: ${laneSet.id}.`);
        }
        allIds.add(laneSet.id);
      }
      for (const lane of laneSet.lanes || []) {
        const laneId = assertValidId(lane.id, '<bpmn:lane>');
        if (allIds.has(laneId)) {
          throw new BpmnValidationError(`Se detectó un id BPMN duplicado: ${laneId}.`);
        }
        allIds.add(laneId);
        for (const ref of lane.flowNodeRef || []) {
          if (!ref.id || !flowNodeIds.has(ref.id)) {
            throw new BpmnValidationError(
              `El carril ${laneId} referencia un nodo inexistente: ${ref.id || 'vacío'}.`
            );
          }
        }
      }
    }
  }

  if (nonEmptyProcesses === 0) {
    throw new BpmnValidationError('El BPMN generado no contiene ningún proceso con elementos.');
  }

  if (collaboration) {
    if (collaboration.id) {
      assertValidId(collaboration.id, '<bpmn:collaboration>');
      if (allIds.has(collaboration.id)) {
        throw new BpmnValidationError(`Se detectó un id BPMN duplicado: ${collaboration.id}.`);
      }
      allIds.add(collaboration.id);
    }

    const participants = collaboration.participants || [];
    if (participants.length === 0) {
      throw new BpmnValidationError('La colaboración debe incluir al menos un participante.');
    }

    const nodeToPoolId = new Map<string, string>();
    for (const part of participants) {
      const partId = assertValidId(part.id, '<bpmn:participant>');
      if (allIds.has(partId)) {
        throw new BpmnValidationError(`Se detectó un id BPMN duplicado: ${partId}.`);
      }
      allIds.add(partId);
      nodeToPoolId.set(partId, partId);

      if (part.processRef?.id) {
        if (!processById.has(part.processRef.id)) {
          throw new BpmnValidationError(
            `El participante ${partId} referencia un proceso inexistente: ${part.processRef.id}.`
          );
        }
        for (const nodeId of processNodeIds.get(part.processRef.id) || []) {
          nodeToPoolId.set(nodeId, partId);
        }
      }
    }

    for (const mf of collaboration.messageFlows || []) {
      const mfId = assertValidId(mf.id, '<bpmn:messageFlow>');
      if (allIds.has(mfId)) {
        throw new BpmnValidationError(`Se detectó un id BPMN duplicado: ${mfId}.`);
      }
      allIds.add(mfId);

      const src = mf.sourceRef?.id;
      const tgt = mf.targetRef?.id;
      const srcPool = src ? nodeToPoolId.get(src) : undefined;
      const tgtPool = tgt ? nodeToPoolId.get(tgt) : undefined;
      if (!src || !tgt || !srcPool || !tgtPool) {
        throw new BpmnValidationError(
          `El flujo de mensaje ${mfId} tiene sourceRef o targetRef inválido.`
        );
      }
      if (srcPool === tgtPool) {
        throw new BpmnValidationError(
          `El flujo de mensaje ${mfId} no puede conectar elementos del mismo Pool (${srcPool}).`
        );
      }
    }
  }

  const isCollabOrLanes =
    Boolean(collaboration) ||
    processes.some((p) => (p.laneSets || []).some((ls) => (ls.lanes || []).length > 0));
  const hasBoundaryEvents = processes.some((p) =>
    (p.flowElements || []).some((el) => el.$type === 'bpmn:BoundaryEvent')
  );
  const useCollabLayout = isCollabOrLanes || hasBoundaryEvents;

  let layoutedXml: string;
  if (useCollabLayout) {
    layoutedXml = separateOverlappingEdges(buildCollaborationLayout(xml, rootElement));
  } else {
    const firstProc = processes.find((p) => (p.flowElements || []).length > 0) || processes[0];
    const processId = firstProc.id || 'Process_1';
    const flowElements = (firstProc.flowElements || []) as ModdleFlowElement[];
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
  }

  if (
    !layoutedXml.includes('BPMNDiagram') ||
    !layoutedXml.includes('BPMNPlane') ||
    !layoutedXml.includes('BPMNShape') ||
    !layoutedXml.includes('BPMNEdge')
  ) {
    throw new BpmnValidationError('El layout BPMN no generó correctamente el bloque DI.');
  }

  assertNoForbiddenPatterns(layoutedXml);

  return layoutedXml;
}
