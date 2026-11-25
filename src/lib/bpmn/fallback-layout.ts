export interface FallbackFlowElement {
  $type: string;
  id?: string;
  sourceRef?: { id?: string };
  targetRef?: { id?: string };
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const COL_GAP = 180;
const ROW_GAP = 130;
const START_X = 120;
const START_Y = 120;

function getNodeSize(type: string): { w: number; h: number } {
  if (
    type === 'bpmn:StartEvent' ||
    type === 'bpmn:EndEvent' ||
    type === 'bpmn:IntermediateCatchEvent' ||
    type === 'bpmn:IntermediateThrowEvent' ||
    type === 'bpmn:BoundaryEvent'
  ) {
    return { w: 36, h: 36 };
  }
  if (
    type === 'bpmn:ExclusiveGateway' ||
    type === 'bpmn:ParallelGateway' ||
    type === 'bpmn:InclusiveGateway' ||
    type === 'bpmn:EventBasedGateway'
  ) {
    return { w: 50, h: 50 };
  }
  return { w: 100, h: 80 };
}

function ensureDiNamespaces(xml: string): string {
  return xml.replace(/<bpmn:definitions\b([^>]*)>/i, (full, attrs: string) => {
    let nextAttrs = attrs;
    if (!/xmlns:bpmndi=/i.test(nextAttrs)) {
      nextAttrs += ' xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"';
    }
    if (!/xmlns:omgdc=/i.test(nextAttrs)) {
      nextAttrs += ' xmlns:omgdc="http://www.omg.org/spec/DD/20100524/DC"';
    }
    if (!/xmlns:omgdi=/i.test(nextAttrs)) {
      nextAttrs += ' xmlns:omgdi="http://www.omg.org/spec/DD/20100524/DI"';
    }
    return `<bpmn:definitions${nextAttrs}>`;
  });
}

/**
 * Layouter determinista de respaldo (BFS por niveles topológicos) para cuando
 * bpmn-auto-layout v1.0.0 lanza un error interno en grafos con ciclos complejos.
 */
export function buildFallbackLayout(
  rawXml: string,
  processId: string,
  flowElements: FallbackFlowElement[]
): string {
  const cleanXml = rawXml
    .replace(/<bpmndi:BPMNDiagram[\s\S]*?<\/bpmndi:BPMNDiagram>/gi, '')
    .trim();

  const nodes = flowElements.filter((el) => el.$type !== 'bpmn:SequenceFlow' && el.id);
  const flows = flowElements.filter((el) => el.$type === 'bpmn:SequenceFlow' && el.id);

  const adjacency = new Map<string, string[]>();
  for (const flow of flows) {
    const src = flow.sourceRef?.id;
    const tgt = flow.targetRef?.id;
    if (!src || !tgt) continue;
    const list = adjacency.get(src) || [];
    list.push(tgt);
    adjacency.set(src, list);
  }

  // Asignar columna por BFS desde StartEvent(s)
  const levelById = new Map<string, number>();
  const queue: string[] = [];
  for (const node of nodes) {
    if (node.$type === 'bpmn:StartEvent' && node.id) {
      levelById.set(node.id, 0);
      queue.push(node.id);
    }
  }

  while (queue.length > 0) {
    const curr = queue.shift() as string;
    const currLevel = levelById.get(curr) ?? 0;
    for (const next of adjacency.get(curr) || []) {
      if (!levelById.has(next)) {
        levelById.set(next, currLevel + 1);
        queue.push(next);
      }
    }
  }

  let maxLevel = 0;
  for (const lvl of levelById.values()) {
    if (lvl > maxLevel) maxLevel = lvl;
  }
  for (const node of nodes) {
    if (node.id && !levelById.has(node.id)) {
      maxLevel += 1;
      levelById.set(node.id, maxLevel);
    }
  }

  // Agrupar por columna y calcular coordenadas centradas en cada celda
  const cols = new Map<number, FallbackFlowElement[]>();
  for (const node of nodes) {
    const lvl = levelById.get(node.id as string) ?? 0;
    const list = cols.get(lvl) || [];
    list.push(node);
    cols.set(lvl, list);
  }

  const boxes = new Map<string, Box>();
  let maxBottomY = START_Y + 80;
  for (const [col, list] of cols.entries()) {
    list.forEach((node, row) => {
      const { w, h } = getNodeSize(node.$type);
      const cellX = START_X + col * COL_GAP;
      const cellY = START_Y + row * ROW_GAP;
      const x = Math.round(cellX + (100 - w) / 2);
      const y = Math.round(cellY + (80 - h) / 2);
      boxes.set(node.id as string, { x, y, w, h });
      if (y + h > maxBottomY) maxBottomY = y + h;
    });
  }

  const shapesXml = nodes
    .map((node) => {
      const id = node.id as string;
      const b = boxes.get(id)!;
      const isMarkerVisible =
        node.$type === 'bpmn:ExclusiveGateway' ? ' isMarkerVisible="true"' : '';
      return `      <bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"${isMarkerVisible}>
        <omgdc:Bounds x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" />
      </bpmndi:BPMNShape>`;
    })
    .join('\n');

  let backChannelIdx = 0;
  const edgesXml = flows
    .map((flow) => {
      const id = flow.id as string;
      const src = flow.sourceRef?.id ? boxes.get(flow.sourceRef.id) : undefined;
      const tgt = flow.targetRef?.id ? boxes.get(flow.targetRef.id) : undefined;
      if (!src || !tgt) return '';

      const sx = Math.round(src.x + src.w);
      const sy = Math.round(src.y + src.h / 2);
      const tx = Math.round(tgt.x);
      const ty = Math.round(tgt.y + tgt.h / 2);

      let waypoints: Array<{ x: number; y: number }>;
      if (tx >= sx) {
        if (Math.abs(sy - ty) <= 4) {
          waypoints = [
            { x: sx, y: sy },
            { x: tx, y: ty },
          ];
        } else {
          const midX = Math.round((sx + tx) / 2);
          waypoints = [
            { x: sx, y: sy },
            { x: midX, y: sy },
            { x: midX, y: ty },
            { x: tx, y: ty },
          ];
        }
      } else {
        // Flujo de retorno (bucle): enrutar por debajo en canales separados
        const routeY = Math.round(maxBottomY + 40 + backChannelIdx * 28);
        backChannelIdx += 1;
        const startMidX = Math.round(src.x + src.w / 2);
        const targetMidX = Math.round(tgt.x + tgt.w / 2);
        waypoints = [
          { x: startMidX, y: Math.round(src.y + src.h) },
          { x: startMidX, y: routeY },
          { x: targetMidX, y: routeY },
          { x: targetMidX, y: Math.round(tgt.y + tgt.h) },
        ];
      }

      const wpXml = waypoints
        .map((wp) => `        <omgdi:waypoint x="${wp.x}" y="${wp.y}" />`)
        .join('\n');

      return `      <bpmndi:BPMNEdge id="${id}_di" bpmnElement="${id}">\n${wpXml}\n      </bpmndi:BPMNEdge>`;
    })
    .filter(Boolean)
    .join('\n');

  const diagramXml = `  <bpmndi:BPMNDiagram id="BPMNDiagram_Fallback">
    <bpmndi:BPMNPlane id="BPMNPlane_Fallback" bpmnElement="${processId}">
${shapesXml}
${edgesXml}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>`;

  const withNs = ensureDiNamespaces(cleanXml);
  return withNs.replace(/<\/bpmn:definitions>/i, `${diagramXml}\n</bpmn:definitions>`);
}
