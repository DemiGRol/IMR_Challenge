export interface CollabFlowElement {
  $type: string;
  id?: string;
  name?: string;
  sourceRef?: { id?: string };
  targetRef?: { id?: string };
  attachedToRef?: { id?: string };
}

export interface CollabLane {
  $type: string;
  id?: string;
  name?: string;
  flowNodeRef?: Array<{ id?: string }>;
}

export interface CollabLaneSet {
  $type: string;
  id?: string;
  lanes?: CollabLane[];
}

export interface CollabProcess {
  $type: string;
  id?: string;
  flowElements?: CollabFlowElement[];
  laneSets?: CollabLaneSet[];
}

export interface CollabParticipant {
  $type: string;
  id?: string;
  name?: string;
  processRef?: { id?: string };
}

export interface CollabMessageFlow {
  $type: string;
  id?: string;
  name?: string;
  sourceRef?: { id?: string };
  targetRef?: { id?: string };
}

export interface CollabCollaboration {
  $type: string;
  id?: string;
  participants?: CollabParticipant[];
  messageFlows?: CollabMessageFlow[];
}

export interface CollabDefinitions {
  rootElements?: Array<CollabProcess | CollabCollaboration>;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Point {
  x: number;
  y: number;
}

const POOL_X = 120;
const POOL_START_Y = 80;
const POOL_HEADER_W = 30;
const LANE_HEADER_W = 30;
const POOL_GAP_Y = 76;
const BLACKBOX_H = 72;
const COL_GAP = 178;
const SUBROW_GAP = 124;
const LANE_PAD_Y = 34;
const LANE_PAD_X = 48;

const GATEWAY_TYPES = new Set([
  'bpmn:ExclusiveGateway',
  'bpmn:ParallelGateway',
  'bpmn:InclusiveGateway',
  'bpmn:EventBasedGateway',
]);

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
  return xml.replace(/<bpmn:definitions\b([^>]*)>/i, (_full, attrs: string) => {
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

function computeTopologicalColumns(
  nodes: CollabFlowElement[],
  flows: CollabFlowElement[]
): { colById: Map<string, number>; backEdgeKeys: Set<string> } {
  const adjacency = new Map<string, string[]>();
  const incomingCount = new Map<string, number>();
  const boundariesByHost = new Map<string, string[]>();
  const hostByBoundary = new Map<string, string>();

  for (const n of nodes) {
    if (n.id) incomingCount.set(n.id, 0);
    if (n.$type === 'bpmn:BoundaryEvent' && n.id && n.attachedToRef?.id) {
      const hostId = n.attachedToRef.id;
      const list = boundariesByHost.get(hostId) || [];
      list.push(n.id);
      boundariesByHost.set(hostId, list);
      hostByBoundary.set(n.id, hostId);
    }
  }
  for (const f of flows) {
    const src = f.sourceRef?.id;
    const tgt = f.targetRef?.id;
    if (!src || !tgt) continue;
    const list = adjacency.get(src) || [];
    list.push(tgt);
    adjacency.set(src, list);
    incomingCount.set(tgt, (incomingCount.get(tgt) || 0) + 1);
  }

  const color = new Map<string, 0 | 1 | 2>();
  const backEdgeKeys = new Set<string>();

  const dfs = (u: string) => {
    color.set(u, 1);
    for (const v of adjacency.get(u) || []) {
      const st = color.get(v) ?? 0;
      if (st === 1) {
        backEdgeKeys.add(`${u}->${v}`);
      } else if (st === 0) {
        dfs(v);
      }
    }
    for (const bId of boundariesByHost.get(u) || []) {
      if ((color.get(bId) ?? 0) === 0) {
        dfs(bId);
      }
    }
    color.set(u, 2);
  };

  for (const n of nodes) {
    if (
      n.id &&
      n.$type !== 'bpmn:BoundaryEvent' &&
      (n.$type === 'bpmn:StartEvent' || incomingCount.get(n.id) === 0) &&
      (color.get(n.id) ?? 0) === 0
    ) {
      dfs(n.id);
    }
  }
  for (const n of nodes) {
    if (n.id && n.$type !== 'bpmn:BoundaryEvent' && (color.get(n.id) ?? 0) === 0) {
      dfs(n.id);
    }
  }
  for (const n of nodes) {
    if (n.id && (color.get(n.id) ?? 0) === 0) {
      dfs(n.id);
    }
  }

  const colById = new Map<string, number>();
  for (const n of nodes) {
    if (n.id) colById.set(n.id, 0);
  }

  const maxIters = Math.max(1, nodes.length + 2);
  for (let iter = 0; iter < maxIters; iter++) {
    let changed = false;
    for (const f of flows) {
      const src = f.sourceRef?.id;
      const tgt = f.targetRef?.id;
      if (!src || !tgt || backEdgeKeys.has(`${src}->${tgt}`)) continue;
      const nextCol = (colById.get(src) ?? 0) + 1;
      if (nextCol > (colById.get(tgt) ?? 0)) {
        colById.set(tgt, nextCol);
        changed = true;
      }
    }
    for (const [bId, hostId] of hostByBoundary.entries()) {
      const hostCol = colById.get(hostId) ?? 0;
      if (colById.get(bId) !== hostCol) {
        colById.set(bId, hostCol);
        changed = true;
      }
    }
    if (!changed) break;
  }

  return { colById, backEdgeKeys };
}

/**
 * Layouter determinista general de Colaboración y Swimlanes BPMN 2.0:
 * - Ordena automáticamente Pools black-box arriba/abajo según los lanes conectados
 * - Alinea columnas DAG longest-path, centra bifurcaciones/joins simétricos y elimina filas muertas
 * - Asigna puertos diferenciados en salidas Y entradas de compuertas
 * - Rutea saltos largos por autopistas perimetrales y retornos superiores sin cruzar tareas vecinas
 */
export function buildCollaborationLayout(
  rawXml: string,
  definitions: CollabDefinitions
): string {
  const cleanXml = rawXml
    .replace(/<bpmndi:BPMNDiagram[\s\S]*?<\/bpmndi:BPMNDiagram>/gi, '')
    .trim();

  const rootElements = definitions.rootElements || [];
  const collaboration = rootElements.find(
    (el): el is CollabCollaboration => el.$type === 'bpmn:Collaboration'
  );
  const processById = new Map<string, CollabProcess>();
  for (const el of rootElements) {
    if (el.$type === 'bpmn:Process' && el.id) {
      processById.set(el.id, el as CollabProcess);
    }
  }

  const rawParticipants: Array<{ participant?: CollabParticipant; process?: CollabProcess }> = [];
  if (collaboration && collaboration.participants && collaboration.participants.length > 0) {
    for (const part of collaboration.participants) {
      const proc = part.processRef?.id ? processById.get(part.processRef.id) : undefined;
      rawParticipants.push({ participant: part, process: proc });
    }
  } else {
    for (const proc of processById.values()) {
      rawParticipants.push({ process: proc });
    }
  }

  // Regla 1: En colaboraciones con >= 2 Pools black-box, ubicar arriba los acoplados a carriles superiores/StartEvent
  // y abajo los acoplados a carriles inferiores para evitar que messageFlows atraviesen otros Pools.
  const whiteBoxEntries = rawParticipants.filter((e) => Boolean(e.process));
  const blackBoxEntries = rawParticipants.filter((e) => !e.process && e.participant?.id);
  let participants = rawParticipants;

  if (whiteBoxEntries.length >= 1 && blackBoxEntries.length >= 2) {
    const nodeLaneInfo = new Map<string, { laneIdx: number; laneCount: number; isStart: boolean }>();
    for (const wb of whiteBoxEntries) {
      const proc = wb.process!;
      const lanes = (proc.laneSets || [])
        .flatMap((ls) => ls.lanes || [])
        .filter((l) => Boolean(l.id));
      const laneCount = Math.max(1, lanes.length);
      const flowElements = proc.flowElements || [];
      const startIds = new Set(
        flowElements
          .filter((el) => el.$type === 'bpmn:StartEvent' && el.id)
          .map((el) => el.id as string)
      );
      if (lanes.length > 0) {
        lanes.forEach((lane, lIdx) => {
          for (const ref of lane.flowNodeRef || []) {
            if (ref.id) {
              nodeLaneInfo.set(ref.id, { laneIdx: lIdx, laneCount, isStart: startIds.has(ref.id) });
            }
          }
        });
      } else {
        for (const el of flowElements) {
          if (el.id && el.$type !== 'bpmn:SequenceFlow') {
            nodeLaneInfo.set(el.id, { laneIdx: 0, laneCount: 1, isStart: startIds.has(el.id) });
          }
        }
      }
    }

    const scoredBlackBoxes = blackBoxEntries.map((bb, origIdx) => {
      const bbId = bb.participant!.id!;
      const scores: number[] = [];
      for (const mf of collaboration?.messageFlows || []) {
        const src = mf.sourceRef?.id;
        const tgt = mf.targetRef?.id;
        const otherId = src === bbId ? tgt : tgt === bbId ? src : undefined;
        const info = otherId ? nodeLaneInfo.get(otherId) : undefined;
        if (!info) continue;
        let score = info.laneCount > 1 ? info.laneIdx / (info.laneCount - 1) : 0.5;
        if (info.isStart && info.laneIdx === 0) score -= 0.3;
        scores.push(score);
      }
      const avgScore =
        scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 1;
      return { entry: bb, avgScore, origIdx };
    });

    const aboveWhite = scoredBlackBoxes
      .filter((s) => s.avgScore < 0.45)
      .sort((a, b) => a.avgScore - b.avgScore || a.origIdx - b.origIdx)
      .map((s) => s.entry);
    const belowWhite = scoredBlackBoxes
      .filter((s) => s.avgScore >= 0.45)
      .sort((a, b) => a.avgScore - b.avgScore || a.origIdx - b.origIdx)
      .map((s) => s.entry);

    participants = [...aboveWhite, ...whiteBoxEntries, ...belowWhite];
  }

  const poolIndexByElementId = new Map<string, number>();
  participants.forEach((entry, poolIdx) => {
    if (entry.participant?.id) {
      poolIndexByElementId.set(entry.participant.id, poolIdx);
    }
    for (const el of entry.process?.flowElements || []) {
      if (el.id && el.$type !== 'bpmn:SequenceFlow') {
        poolIndexByElementId.set(el.id, poolIdx);
      }
    }
  });

  const processMetrics = new Map<
    string,
    {
      nodes: CollabFlowElement[];
      flows: CollabFlowElement[];
      colById: Map<string, number>;
      backEdgeKeys: Set<string>;
      maxCol: number;
      lanes: CollabLane[];
    }
  >();

  let globalMaxCol = 3;
  for (const entry of participants) {
    const proc = entry.process;
    if (!proc || !proc.id) continue;
    const flowElements = proc.flowElements || [];
    const nodes = flowElements.filter((el) => el.$type !== 'bpmn:SequenceFlow' && el.id);
    const flows = flowElements.filter((el) => el.$type === 'bpmn:SequenceFlow' && el.id);
    if (nodes.length === 0) continue;

    const { colById, backEdgeKeys } = computeTopologicalColumns(nodes, flows);
    let maxCol = 0;
    for (const c of colById.values()) {
      if (c > maxCol) maxCol = c;
    }
    if (maxCol > globalMaxCol) globalMaxCol = maxCol;

    const lanes = (proc.laneSets || [])
      .flatMap((ls) => ls.lanes || [])
      .filter((l) => Boolean(l.id));
    processMetrics.set(proc.id, { nodes, flows, colById, backEdgeKeys, maxCol, lanes });
  }

  const hasAnyLanes = Array.from(processMetrics.values()).some((m) => m.lanes.length > 0);
  const contentOffsetX =
    (collaboration ? POOL_HEADER_W : 0) + (hasAnyLanes ? LANE_HEADER_W : 0) + LANE_PAD_X;
  const uniformPoolWidth = Math.max(
    640,
    contentOffsetX + (globalMaxCol + 1) * COL_GAP + LANE_PAD_X
  );

  const shapeXmlParts: string[] = [];
  const edgeXmlParts: string[] = [];
  const boxes = new Map<string, Box>();
  const obstacleBoxes: Array<{ id: string; box: Box }> = [];

  const findVerticalObstacle = (
    x: number,
    y1: number,
    y2: number,
    srcId: string,
    tgtId: string
  ): Box | undefined => {
    const minY = Math.min(y1, y2) + 4;
    const maxY = Math.max(y1, y2) - 4;
    return obstacleBoxes.find(
      ({ id: obsId, box }) =>
        obsId !== srcId &&
        obsId !== tgtId &&
        x >= box.x - 10 &&
        x <= box.x + box.w + 10 &&
        box.y < maxY &&
        box.y + box.h > minY
    )?.box;
  };

  const findAllHorizontalObstacles = (
    y: number,
    x1: number,
    x2: number,
    srcId: string,
    tgtId: string
  ): Box[] => {
    const minX = Math.min(x1, x2) + 4;
    const maxX = Math.max(x1, x2) - 4;
    if (maxX <= minX) return [];
    return obstacleBoxes
      .filter(
        ({ id: obsId, box }) =>
          obsId !== srcId &&
          obsId !== tgtId &&
          y >= box.y - 8 &&
          y <= box.y + box.h + 8 &&
          box.x < maxX &&
          box.x + box.w > minX
      )
      .map((item) => item.box);
  };

  const routeHorizontalClearance = (
    x1: number,
    x2: number,
    y: number,
    srcId: string,
    tgtId: string
  ): Point[] => {
    if (x2 <= x1 + 12) return [];
    const hits = findAllHorizontalObstacles(y, x1, x2, srcId, tgtId);
    if (hits.length === 0) return [];

    const minObsX = Math.min(...hits.map((b) => b.x));
    const maxObsX = Math.max(...hits.map((b) => b.x + b.w));
    const minObsY = Math.min(...hits.map((b) => b.y));
    const maxObsY = Math.max(...hits.map((b) => b.y + b.h));

    const enterX = Math.max(x1 + 10, Math.round(minObsX - 16));
    const exitX = Math.min(x2 - 10, Math.round(maxObsX + 16));
    if (exitX <= enterX + 4) return [];

    let aboveY = Math.round(minObsY - 18);
    for (let step = 0; step < 5; step++) {
      if (findAllHorizontalObstacles(aboveY, enterX, exitX, srcId, tgtId).length === 0) break;
      aboveY -= 18;
    }

    let belowY = Math.round(maxObsY + 18);
    for (let step = 0; step < 5; step++) {
      if (findAllHorizontalObstacles(belowY, enterX, exitX, srcId, tgtId).length === 0) break;
      belowY += 18;
    }

    const aboveClear = findAllHorizontalObstacles(aboveY, enterX, exitX, srcId, tgtId).length === 0;
    const belowClear = findAllHorizontalObstacles(belowY, enterX, exitX, srcId, tgtId).length === 0;
    const detourY =
      aboveClear && belowClear
        ? Math.abs(aboveY - y) <= Math.abs(belowY - y)
          ? aboveY
          : belowY
        : aboveClear
          ? aboveY
          : belowY;

    return [
      { x: enterX, y },
      { x: enterX, y: detourY },
      { x: exitX, y: detourY },
      { x: exitX, y },
    ];
  };

  const pickSideBypassX = (
    blocking: Box,
    tx: number,
    y1: number,
    y2: number,
    srcId: string,
    tgtId: string
  ): number => {
    const rightX = Math.round(blocking.x + blocking.w + 14);
    const leftX = Math.round(blocking.x - 14);
    if (rightX < tx - 8 && !findVerticalObstacle(rightX, y1, y2, srcId, tgtId)) {
      return rightX;
    }
    if (!findVerticalObstacle(leftX, y1, y2, srcId, tgtId)) {
      return leftX;
    }
    return rightX < tx - 8 ? rightX : leftX;
  };

  let currentY = POOL_START_Y;
  const messageFlows = collaboration?.messageFlows || [];

  for (let currentPoolIdx = 0; currentPoolIdx < participants.length; currentPoolIdx++) {
    const entry = participants[currentPoolIdx];
    const part = entry.participant;
    const proc = entry.process;
    const metrics = proc?.id ? processMetrics.get(proc.id) : undefined;

    if (!metrics) {
      if (part?.id) {
        const box: Box = { x: POOL_X, y: currentY, w: uniformPoolWidth, h: BLACKBOX_H };
        boxes.set(part.id, box);
        shapeXmlParts.push(
          `      <bpmndi:BPMNShape id="${part.id}_di" bpmnElement="${part.id}" isHorizontal="true">\n` +
            `        <omgdc:Bounds x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" />\n` +
            `      </bpmndi:BPMNShape>`
        );
        currentY += BLACKBOX_H + POOL_GAP_Y;
      }
      continue;
    }

    const { nodes, flows, colById, lanes } = metrics;
    const nodeTypeById = new Map<string, string>();
    for (const n of nodes) {
      if (n.id) nodeTypeById.set(n.id, n.$type);
    }

    const boundaryNodes = nodes.filter((n) => n.$type === 'bpmn:BoundaryEvent' && n.id);
    const gridNodes = nodes.filter((n) => n.$type !== 'bpmn:BoundaryEvent');
    const boundaryEventIds = new Set(boundaryNodes.map((b) => b.id as string));
    const boundariesByHostId = new Map<string, CollabFlowElement[]>();
    const hostByBoundaryId = new Map<string, string>();
    for (const b of boundaryNodes) {
      const hostId = b.attachedToRef?.id;
      if (!hostId || !b.id) continue;
      const list = boundariesByHostId.get(hostId) || [];
      list.push(b);
      boundariesByHostId.set(hostId, list);
      hostByBoundaryId.set(b.id, hostId);
    }

    const poolStartY = currentY;
    const laneOffsetX = POOL_X + (part ? POOL_HEADER_W : 0);
    const laneWidth = uniformPoolWidth - (part ? POOL_HEADER_W : 0);
    const nodeBaseX = laneOffsetX + (lanes.length > 0 ? LANE_HEADER_W : 0) + LANE_PAD_X;

    const laneGroups: Array<{ lane?: CollabLane; nodes: CollabFlowElement[] }> = [];
    if (lanes.length > 0) {
      const assigned = new Set<string>();
      for (const lane of lanes) {
        const refSet = new Set((lane.flowNodeRef || []).map((r) => r.id).filter(Boolean));
        const laneNodes = gridNodes.filter((n) => n.id && refSet.has(n.id));
        laneNodes.forEach((n) => n.id && assigned.add(n.id));
        laneGroups.push({ lane, nodes: laneNodes });
      }
      const unassigned = gridNodes.filter((n) => n.id && !assigned.has(n.id));
      if (unassigned.length > 0) {
        laneGroups[0].nodes.push(...unassigned);
      }
    } else {
      laneGroups.push({ nodes: gridNodes });
    }

    const laneIndexByNodeId = new Map<string, number>();
    laneGroups.forEach((g, laneIdx) => {
      for (const n of g.nodes) {
        if (n.id) laneIndexByNodeId.set(n.id, laneIdx);
      }
    });

    const outgoingTargetsByNodeId = new Map<string, string[]>();
    const incomingNormalByNodeId = new Map<string, string[]>();
    const incomingBoundaryHostsByNodeId = new Map<string, string[]>();
    const incomingCountById = new Map<string, number>();
    const hasBoundaryIncoming = new Set<string>();
    const hasNormalIncoming = new Set<string>();

    for (const flow of flows) {
      const src = flow.sourceRef?.id;
      const tgt = flow.targetRef?.id;
      if (!src || !tgt) continue;
      const list = outgoingTargetsByNodeId.get(src) || [];
      list.push(tgt);
      outgoingTargetsByNodeId.set(src, list);
      incomingCountById.set(tgt, (incomingCountById.get(tgt) || 0) + 1);

      const srcCol = colById.get(src) ?? 0;
      const tgtCol = colById.get(tgt) ?? 0;
      if (boundaryEventIds.has(src)) {
        hasBoundaryIncoming.add(tgt);
        const hostId = hostByBoundaryId.get(src);
        if (hostId && srcCol < tgtCol) {
          const hList = incomingBoundaryHostsByNodeId.get(tgt) || [];
          hList.push(hostId);
          incomingBoundaryHostsByNodeId.set(tgt, hList);
        }
      } else {
        hasNormalIncoming.add(tgt);
        if (srcCol < tgtCol) {
          const nList = incomingNormalByNodeId.get(tgt) || [];
          nList.push(src);
          incomingNormalByNodeId.set(tgt, nList);
        }
      }
    }

    const rejoinsMerge = (startId: string): boolean => {
      const visited = new Set<string>([startId]);
      const q: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];
      while (q.length > 0) {
        const { id, depth } = q.shift()!;
        if ((incomingCountById.get(id) ?? 0) >= 2) return true;
        if (depth >= 4) continue;
        for (const nxt of outgoingTargetsByNodeId.get(id) || []) {
          if (!visited.has(nxt)) {
            visited.add(nxt);
            q.push({ id: nxt, depth: depth + 1 });
          }
        }
      }
      return false;
    };

    const verticalGravity = (nodeId: string, ownLaneIdx: number): number => {
      const targets = outgoingTargetsByNodeId.get(nodeId) || [];
      let gravity =
        targets.length > 0
          ? targets.reduce(
              (sum, targetId) => sum + (laneIndexByNodeId.get(targetId) ?? ownLaneIdx),
              0
            ) / targets.length
          : ownLaneIdx;

      for (const mf of messageFlows) {
        const src = mf.sourceRef?.id;
        const tgt = mf.targetRef?.id;
        const otherId = src === nodeId ? tgt : tgt === nodeId ? src : undefined;
        if (!otherId) continue;
        const otherPoolIdx = poolIndexByElementId.get(otherId);
        if (otherPoolIdx === undefined) continue;
        if (otherPoolIdx > currentPoolIdx) gravity += 0.6;
        else if (otherPoolIdx < currentPoolIdx) gravity -= 0.6;
      }

      if (hasBoundaryIncoming.has(nodeId) && !hasNormalIncoming.has(nodeId)) {
        gravity += 0.4;
      }

      return gravity;
    };

    // Primera pasada de grilla lógica por carril (slots relativos normalizados antes de calcular alturas Y)
    const assignedSubRow = new Map<string, number>();
    const laneSlotPlans: Array<{
      lane?: CollabLane;
      laneIdx: number;
      nodes: CollabFlowElement[];
      sortedCols: number[];
      colSlotAssignments: Map<number, Array<{ node: CollabFlowElement; subRow: number }>>;
      maxSubRows: number;
    }> = [];

    for (const [laneIdx, group] of laneGroups.entries()) {
      const byCol = new Map<number, CollabFlowElement[]>();
      for (const node of group.nodes) {
        const col = colById.get(node.id as string) ?? 0;
        const list = byCol.get(col) || [];
        list.push(node);
        byCol.set(col, list);
      }

      const sortedCols = Array.from(byCol.keys()).sort((a, b) => a - b);
      const colSlotAssignments = new Map<number, Array<{ node: CollabFlowElement; subRow: number }>>();
      let laneMaxAssignedRow = 0;

      const preferredSubRow = (nodeId: string): number => {
        const normalPreds = (incomingNormalByNodeId.get(nodeId) || []).filter(
          (p) => laneIndexByNodeId.get(p) === laneIdx && assignedSubRow.has(p)
        );
        if (normalPreds.length > 0) {
          const rows = normalPreds.map((p) => assignedSubRow.get(p) as number);
          if (rows.length === 1) return rows[0];
          const avgR = rows.reduce((s, r) => s + r, 0) / rows.length;
          // Regla general: joins simétricos de 3+ ramas en mismo carril se centran; de 2 ramas mantienen línea principal
          if (GATEWAY_TYPES.has(nodeTypeById.get(nodeId) || '') && rows.length >= 3) {
            return avgR;
          }
          const minR = Math.min(...rows);
          return minR * 0.65 + avgR * 0.35;
        }

        const boundaryHosts = (incomingBoundaryHostsByNodeId.get(nodeId) || []).filter(
          (h) => laneIndexByNodeId.get(h) === laneIdx && assignedSubRow.has(h)
        );
        if (boundaryHosts.length > 0) {
          const avgHostRow =
            boundaryHosts.reduce((s, h) => s + (assignedSubRow.get(h) as number), 0) /
            boundaryHosts.length;
          return avgHostRow + (rejoinsMerge(nodeId) ? 1.15 : 1.3);
        }

        const crossLanePreds = (incomingNormalByNodeId.get(nodeId) || [])
          .map((p) => laneIndexByNodeId.get(p))
          .filter((l): l is number => l !== undefined && l !== laneIdx);
        if (crossLanePreds.length > 0) {
          const avgOtherLane =
            crossLanePreds.reduce((s, l) => s + l, 0) / crossLanePreds.length;
          if (avgOtherLane < laneIdx) return -0.5;
          if (avgOtherLane > laneIdx) return laneMaxAssignedRow + 1;
        }

        return verticalGravity(nodeId, laneIdx) - laneIdx;
      };

      for (const col of sortedCols) {
        const colNodes = byCol.get(col) || [];
        if (colNodes.length > 1) {
          colNodes.sort((a, b) => {
            const pa = preferredSubRow(a.id as string);
            const pb = preferredSubRow(b.id as string);
            if (Math.abs(pa - pb) > 0.01) return pa - pb;
            return (
              verticalGravity(a.id as string, laneIdx) - verticalGravity(b.id as string, laneIdx)
            );
          });
        }

        const desiredList = colNodes.map((node) => {
          const id = node.id as string;
          const pref = preferredSubRow(id);
          let desired = Number.isFinite(pref) ? Math.max(0, Math.round(pref)) : 0;

          // Regla general: compuertas divergentes con >= 3 ramas en el mismo carril evitan pegarse al techo
          if (GATEWAY_TYPES.has(node.$type)) {
            const forwardSameLaneCount = (outgoingTargetsByNodeId.get(id) || []).filter(
              (t) => (colById.get(t) ?? 0) > col && laneIndexByNodeId.get(t) === laneIdx
            ).length;
            if (forwardSameLaneCount >= 3) {
              desired = Math.max(1, desired);
            }
          }
          return desired;
        });

        // Regla general: centrar abanicos (fan-out >= 3) alrededor de su compuerta origen única
        let i = 0;
        while (i < colNodes.length) {
          const id = colNodes[i].id as string;
          const preds = (incomingNormalByNodeId.get(id) || []).filter(
            (p) => laneIndexByNodeId.get(p) === laneIdx && assignedSubRow.has(p)
          );
          const singleGatewayPred =
            preds.length === 1 && GATEWAY_TYPES.has(nodeTypeById.get(preds[0]) || '')
              ? preds[0]
              : null;

          if (!singleGatewayPred) {
            i += 1;
            continue;
          }

          let j = i + 1;
          while (j < colNodes.length) {
            const jId = colNodes[j].id as string;
            const jPreds = (incomingNormalByNodeId.get(jId) || []).filter(
              (p) => laneIndexByNodeId.get(p) === laneIdx && assignedSubRow.has(p)
            );
            if (jPreds.length === 1 && jPreds[0] === singleGatewayPred) {
              j += 1;
            } else {
              break;
            }
          }

          const fanLen = j - i;
          if (fanLen >= 3) {
            const rG = assignedSubRow.get(singleGatewayPred) as number;
            const idealStart = Math.max(0, rG - Math.floor((fanLen - 1) / 2));
            for (let k = 0; k < fanLen; k++) {
              desiredList[i + k] = idealStart + k;
            }
          }
          i = j;
        }

        let nextFreeSlot = 0;
        const placements: Array<{ node: CollabFlowElement; subRow: number }> = [];
        colNodes.forEach((node, idx) => {
          const slot = Math.max(nextFreeSlot, desiredList[idx]);
          placements.push({ node, subRow: slot });
          assignedSubRow.set(node.id as string, slot);
          if (slot > laneMaxAssignedRow) laneMaxAssignedRow = slot;
          nextFreeSlot = slot + 1;
        });
        colSlotAssignments.set(col, placements);
      }

      // Compactación densa de sub-filas del carril (garantiza 0..K-1 sin huecos vacíos ni bandas gigantes)
      const usedSlots = new Set<number>();
      for (const placements of colSlotAssignments.values()) {
        for (const p of placements) {
          usedSlots.add(p.subRow);
        }
      }
      const sortedUsedSlots = Array.from(usedSlots).sort((a, b) => a - b);
      const compactSlotMap = new Map<number, number>();
      sortedUsedSlots.forEach((slot, denseIdx) => compactSlotMap.set(slot, denseIdx));

      const maxSubRows = Math.max(1, sortedUsedSlots.length);
      for (const placements of colSlotAssignments.values()) {
        for (const p of placements) {
          p.subRow = compactSlotMap.get(p.subRow) ?? 0;
          if (p.node.id) assignedSubRow.set(p.node.id, p.subRow);
        }
      }

      laneSlotPlans.push({
        lane: group.lane,
        laneIdx,
        nodes: group.nodes,
        sortedCols,
        colSlotAssignments,
        maxSubRows,
      });
    }

    // Identificar saltos largos (tgtCol - srcCol >= 3) y retornos superiores por carril
    const longSpanSlotByFlowId = new Map<
      string,
      { highwayPos: 'bottom' | 'top'; laneIdx: number; slot: number }
    >();
    const longSpanCountByLane = new Map<number, { bottom: number; top: number }>();

    for (const flow of flows) {
      const fId = flow.id;
      const srcId = flow.sourceRef?.id;
      const tgtId = flow.targetRef?.id;
      if (!fId || !srcId || !tgtId || boundaryEventIds.has(srcId)) continue;
      const srcCol = colById.get(srcId);
      const tgtCol = colById.get(tgtId);
      const srcLane = laneIndexByNodeId.get(srcId);
      const tgtLane = laneIndexByNodeId.get(tgtId);
      if (
        srcCol === undefined ||
        tgtCol === undefined ||
        srcLane === undefined ||
        tgtLane === undefined
      ) {
        continue;
      }
      if (tgtCol - srcCol >= 3) {
        const srcRow = assignedSubRow.get(srcId) ?? 0;
        const tgtRow = assignedSubRow.get(tgtId) ?? 0;
        if (srcLane === tgtLane && srcRow === tgtRow) {
          const lanePlan = laneSlotPlans[srcLane];
          let blocked = false;
          for (let c = srcCol + 1; c < tgtCol; c++) {
            const colItems = lanePlan?.colSlotAssignments.get(c) || [];
            if (colItems.some((item) => item.subRow === srcRow)) {
              blocked = true;
              break;
            }
          }
          if (!blocked) continue;
        }
        const highwayPos: 'bottom' | 'top' = tgtLane >= srcLane ? 'bottom' : 'top';
        const counts = longSpanCountByLane.get(tgtLane) || { bottom: 0, top: 0 };
        const slot = counts[highwayPos];
        counts[highwayPos] += 1;
        longSpanCountByLane.set(tgtLane, counts);
        longSpanSlotByFlowId.set(fId, { highwayPos, laneIdx: tgtLane, slot });
      }
    }

    const topBackEdgeCountByLane = new Map<number, number>();
    for (const flow of flows) {
      const srcId = flow.sourceRef?.id;
      const tgtId = flow.targetRef?.id;
      if (!srcId || !tgtId || boundaryEventIds.has(srcId)) continue;
      const srcCol = colById.get(srcId) ?? 0;
      const tgtCol = colById.get(tgtId) ?? 0;
      const srcLane = laneIndexByNodeId.get(srcId);
      const tgtLane = laneIndexByNodeId.get(tgtId);
      if (tgtCol < srcCol && srcLane !== undefined && srcLane === tgtLane) {
        const rSrc = assignedSubRow.get(srcId) ?? 0;
        const rTgt = assignedSubRow.get(tgtId) ?? 0;
        if (Math.min(rSrc, rTgt) === 0) {
          topBackEdgeCountByLane.set(srcLane, (topBackEdgeCountByLane.get(srcLane) || 0) + 1);
        }
      }
    }

    const poolShapeSlotIdx = shapeXmlParts.length;
    if (part?.id) {
      shapeXmlParts.push('');
    }

    let laneY = poolStartY;
    let poolBottomY = poolStartY;
    const laneBoxesByIdx = new Map<number, Box>();
    const hostsToPlaceBoundaries: Array<{
      hostBox: Box;
      attached: CollabFlowElement[];
    }> = [];

    for (const plan of laneSlotPlans) {
      const { lane, laneIdx, nodes: laneNodes, sortedCols, colSlotAssignments, maxSubRows } = plan;

      const multiBoundarySubRows = new Set<number>();
      for (const n of laneNodes) {
        if (n.id && (boundariesByHostId.get(n.id)?.length || 0) >= 2) {
          multiBoundarySubRows.add(assignedSubRow.get(n.id) ?? 0);
        }
      }

      const topLoops = topBackEdgeCountByLane.get(laneIdx) || 0;
      const longCounts = longSpanCountByLane.get(laneIdx) || { bottom: 0, top: 0 };
      const topPad =
        LANE_PAD_Y +
        (topLoops > 0 ? 16 + topLoops * 14 : 0) +
        (longCounts.top > 0 ? 16 + longCounts.top * 14 : 0);

      const rowYBySlot: number[] = [];
      let cursorY = laneY + topPad;
      for (let r = 0; r < maxSubRows; r++) {
        rowYBySlot[r] = cursorY;
        cursorY += SUBROW_GAP + (multiBoundarySubRows.has(r) ? 34 : 0);
      }

      const hasBoundariesInGroup = laneNodes.some(
        (n) => n.id && (boundariesByHostId.get(n.id)?.length || 0) > 0
      );
      const hasMultiAtLastRow = multiBoundarySubRows.has(maxSubRows - 1);
      const contentBottomY =
        maxSubRows > 0 ? rowYBySlot[maxSubRows - 1] + 80 : laneY + topPad + 80;
      const bottomPad =
        LANE_PAD_Y +
        (hasBoundariesInGroup ? (hasMultiAtLastRow ? 48 : 34) : 0) +
        (longCounts.bottom > 0 ? 18 + longCounts.bottom * 14 : 0);
      const laneHeight = Math.max(136, contentBottomY - laneY + bottomPad);

      const laneBox: Box = { x: laneOffsetX, y: laneY, w: laneWidth, h: laneHeight };
      laneBoxesByIdx.set(laneIdx, laneBox);
      if (lane?.id) {
        boxes.set(lane.id, laneBox);
        shapeXmlParts.push(
          `      <bpmndi:BPMNShape id="${lane.id}_di" bpmnElement="${lane.id}" isHorizontal="true">\n` +
            `        <omgdc:Bounds x="${laneBox.x}" y="${laneBox.y}" width="${laneBox.w}" height="${laneBox.h}" />\n` +
            `      </bpmndi:BPMNShape>`
        );
      }

      for (const col of sortedCols) {
        const placements = colSlotAssignments.get(col) || [];
        for (const { node, subRow } of placements) {
          const id = node.id as string;
          const baseSize = getNodeSize(node.$type);
          const attached = boundariesByHostId.get(id);
          const w =
            baseSize.w === 100 && attached && attached.length >= 2
              ? baseSize.w + Math.min(2, attached.length - 1) * 28
              : baseSize.w;
          const h = baseSize.h;
          const cellX = nodeBaseX + col * COL_GAP;
          const cellY = rowYBySlot[subRow] ?? laneY + topPad + subRow * SUBROW_GAP;
          const x = Math.round(cellX + (100 - w) / 2);
          const y = Math.round(cellY + (80 - h) / 2);
          const nodeBox: Box = { x, y, w, h };
          boxes.set(id, nodeBox);
          obstacleBoxes.push({ id, box: nodeBox });

          const isMarkerVisible =
            node.$type === 'bpmn:ExclusiveGateway' ? ' isMarkerVisible="true"' : '';
          shapeXmlParts.push(
            `      <bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"${isMarkerVisible}>\n` +
              `        <omgdc:Bounds x="${x}" y="${y}" width="${w}" height="${h}" />\n` +
              `      </bpmndi:BPMNShape>`
          );

          if (attached && attached.length > 0) {
            hostsToPlaceBoundaries.push({ hostBox: nodeBox, attached });
          }
        }
      }

      laneY += laneHeight;
      poolBottomY = laneY;
    }

    // Segunda pasada: posicionar Boundary Events ordenando destino más profundo a la izquierda
    const boundarySlotMeta = new Map<string, { indexFromRight: number; count: number }>();
    for (const { hostBox, attached } of hostsToPlaceBoundaries) {
      const targetCenterYForBoundary = (bNode: CollabFlowElement): number => {
        const bId = bNode.id;
        if (!bId) return hostBox.y + hostBox.h + 100;
        const firstTgt = (outgoingTargetsByNodeId.get(bId) || [])[0];
        const tb = firstTgt ? boxes.get(firstTgt) : undefined;
        return tb ? tb.y + tb.h / 2 : hostBox.y + hostBox.h + 100;
      };

      const sortedAttached =
        attached.length > 1
          ? [...attached].sort((a, b) => targetCenterYForBoundary(b) - targetCenterYForBoundary(a))
          : attached;

      sortedAttached.forEach((bNode, idx) => {
        const bId = bNode.id as string;
        const bw = 36;
        const bh = 36;
        const cx =
          sortedAttached.length === 1
            ? hostBox.x + hostBox.w / 2
            : hostBox.x + 22 + (idx * Math.max(0, hostBox.w - 44)) / (sortedAttached.length - 1);
        const bx = Math.round(cx - bw / 2);
        const by = Math.round(hostBox.y + hostBox.h - bh / 2);
        const bBox: Box = { x: bx, y: by, w: bw, h: bh };
        boxes.set(bId, bBox);
        obstacleBoxes.push({ id: bId, box: bBox });
        boundarySlotMeta.set(bId, {
          indexFromRight: sortedAttached.length - 1 - idx,
          count: sortedAttached.length,
        });

        let labelXml = '';
        if (sortedAttached.length >= 2 && bNode.name) {
          const labelW = 88;
          const labelH = 27;
          const isLeftmost = idx === 0;
          const isRightmost = idx === sortedAttached.length - 1;
          const labelX = isLeftmost
            ? Math.round(bx - 52)
            : isRightmost
              ? Math.round(bx + 2)
              : Math.round(cx - labelW / 2);
          const labelY = isLeftmost || isRightmost ? by + bh + 4 : by + bh + 26;
          labelXml =
            `\n        <bpmndi:BPMNLabel>\n` +
            `          <omgdc:Bounds x="${labelX}" y="${labelY}" width="${labelW}" height="${labelH}" />\n` +
            `        </bpmndi:BPMNLabel>`;
        }

        shapeXmlParts.push(
          `      <bpmndi:BPMNShape id="${bId}_di" bpmnElement="${bId}">\n` +
            `        <omgdc:Bounds x="${bx}" y="${by}" width="${bw}" height="${bh}" />${labelXml}\n` +
            `      </bpmndi:BPMNShape>`
        );
      });
    }

    const poolHeight = Math.max(140, poolBottomY - poolStartY);
    if (part?.id) {
      const poolBox: Box = { x: POOL_X, y: poolStartY, w: uniformPoolWidth, h: poolHeight };
      boxes.set(part.id, poolBox);
      shapeXmlParts[poolShapeSlotIdx] =
        `      <bpmndi:BPMNShape id="${part.id}_di" bpmnElement="${part.id}" isHorizontal="true">\n` +
        `        <omgdc:Bounds x="${poolBox.x}" y="${poolBox.y}" width="${poolBox.w}" height="${poolBox.h}" />\n` +
        `      </bpmndi:BPMNShape>`;
    }

    // Puertos de SALIDA diferenciados por compuerta divergente según geometría real
    const gatewayForwardFlows = new Map<string, CollabFlowElement[]>();
    for (const flow of flows) {
      const srcId = flow.sourceRef?.id;
      const tgtId = flow.targetRef?.id;
      if (!srcId || !tgtId || !GATEWAY_TYPES.has(nodeTypeById.get(srcId) || '')) continue;
      const srcBox = boxes.get(srcId);
      const tgtBox = boxes.get(tgtId);
      if (!srcBox || !tgtBox) continue;
      if (tgtBox.x >= srcBox.x + srcBox.w / 2 - 4) {
        const list = gatewayForwardFlows.get(srcId) || [];
        list.push(flow);
        gatewayForwardFlows.set(srcId, list);
      }
    }

    type GatewayOutPort = 'top' | 'right' | 'bottom';
    const gatewayPortAssignments = new Map<
      string,
      { port: GatewayOutPort; corridorOffset: number }
    >();

    for (const [srcId, gwFlows] of gatewayForwardFlows.entries()) {
      if (gwFlows.length < 2) continue;
      const srcBox = boxes.get(srcId)!;
      const srcCenterY = srcBox.y + srcBox.h / 2;
      const effectiveOutTargetY = (f: CollabFlowElement): number => {
        const lSpan = f.id ? longSpanSlotByFlowId.get(f.id) : undefined;
        if (lSpan) {
          const lb = laneBoxesByIdx.get(lSpan.laneIdx);
          if (lb) {
            return lSpan.highwayPos === 'bottom'
              ? lb.y + lb.h - 14 - lSpan.slot * 14
              : lb.y + 14 + lSpan.slot * 14;
          }
        }
        const tb = f.targetRef?.id ? boxes.get(f.targetRef.id) : undefined;
        return tb ? tb.y + tb.h / 2 : srcCenterY;
      };

      const sorted = [...gwFlows].sort((a, b) => effectiveOutTargetY(a) - effectiveOutTargetY(b));
      const up = sorted.filter((f) => effectiveOutTargetY(f) < srcCenterY - 12);
      const straight = sorted.filter((f) => Math.abs(effectiveOutTargetY(f) - srcCenterY) <= 12);
      const down = sorted.filter((f) => effectiveOutTargetY(f) > srcCenterY + 12);

      let rightUsed = false;
      straight.forEach((f, idx) => {
        if (!f.id) return;
        if (idx === 0) {
          gatewayPortAssignments.set(f.id, { port: 'right', corridorOffset: 0 });
          rightUsed = true;
        } else {
          gatewayPortAssignments.set(f.id, { port: 'bottom', corridorOffset: idx * 24 });
        }
      });

      up.forEach((f, idx) => {
        if (!f.id) return;
        if (idx === 0) {
          gatewayPortAssignments.set(f.id, { port: 'top', corridorOffset: 0 });
        } else if (!rightUsed) {
          gatewayPortAssignments.set(f.id, { port: 'right', corridorOffset: 0 });
          rightUsed = true;
        } else {
          gatewayPortAssignments.set(f.id, { port: 'top', corridorOffset: idx * 24 });
        }
      });

      if (down.length === 1 && down[0].id) {
        gatewayPortAssignments.set(down[0].id, { port: 'bottom', corridorOffset: 0 });
      } else if (down.length >= 2) {
        let downStartIdx = 0;
        if (!rightUsed && down[0].id) {
          gatewayPortAssignments.set(down[0].id, { port: 'right', corridorOffset: 0 });
          rightUsed = true;
          downStartIdx = 1;
        }
        const remainingDown = down.slice(downStartIdx);
        const lastIdx = remainingDown.length - 1;
        remainingDown.forEach((f, idx) => {
          if (!f.id) return;
          const offset = idx === lastIdx ? 0 : (lastIdx - idx) * 24;
          gatewayPortAssignments.set(f.id, { port: 'bottom', corridorOffset: offset });
        });
      }
    }

    // Regla 5: Puertos de ENTRADA diferenciados en compuertas convergentes (top / left / bottom)
    const gatewayIncomingFlows = new Map<string, CollabFlowElement[]>();
    for (const flow of flows) {
      const srcId = flow.sourceRef?.id;
      const tgtId = flow.targetRef?.id;
      if (!srcId || !tgtId || !GATEWAY_TYPES.has(nodeTypeById.get(tgtId) || '')) continue;
      const srcBox = boxes.get(srcId);
      const tgtBox = boxes.get(tgtId);
      if (!srcBox || !tgtBox) continue;
      if (srcBox.x + srcBox.w / 2 <= tgtBox.x + 4) {
        const list = gatewayIncomingFlows.get(tgtId) || [];
        list.push(flow);
        gatewayIncomingFlows.set(tgtId, list);
      }
    }

    type GatewayInPort = 'top' | 'left' | 'bottom';
    const gatewayInPortAssignments = new Map<
      string,
      { port: GatewayInPort; corridorOffset: number }
    >();

    for (const [tgtId, inFlows] of gatewayIncomingFlows.entries()) {
      if (inFlows.length < 2) continue;
      const tgtBox = boxes.get(tgtId)!;
      const tgtCenterY = tgtBox.y + tgtBox.h / 2;
      const sourceCenterY = (f: CollabFlowElement): number => {
        const lSpan = f.id ? longSpanSlotByFlowId.get(f.id) : undefined;
        if (lSpan) {
          const lb = laneBoxesByIdx.get(lSpan.laneIdx);
          if (lb) {
            return lSpan.highwayPos === 'bottom'
              ? lb.y + lb.h - 14 - lSpan.slot * 14
              : lb.y + 14 + lSpan.slot * 14;
          }
        }
        const sb = f.sourceRef?.id ? boxes.get(f.sourceRef.id) : undefined;
        return sb ? sb.y + sb.h / 2 : tgtCenterY;
      };

      const sorted = [...inFlows].sort((a, b) => sourceCenterY(a) - sourceCenterY(b));

      let leftUsed = false;
      let topCount = 0;
      let bottomCount = 0;

      // Reservar primero los saltos largos en su puerto perimetral (bottom o top)
      const assignedIds = new Set<string>();
      for (const f of sorted) {
        if (!f.id) continue;
        const lSpan = longSpanSlotByFlowId.get(f.id);
        if (!lSpan) continue;
        if (lSpan.highwayPos === 'bottom') {
          gatewayInPortAssignments.set(f.id, { port: 'bottom', corridorOffset: bottomCount * 16 });
          bottomCount += 1;
          assignedIds.add(f.id);
        } else {
          gatewayInPortAssignments.set(f.id, { port: 'top', corridorOffset: topCount * 16 });
          topCount += 1;
          assignedIds.add(f.id);
        }
      }

      const remainingFlows = sorted.filter((f) => !f.id || !assignedIds.has(f.id));
      const remAbove = remainingFlows.filter((f) => sourceCenterY(f) < tgtCenterY - 12);
      const remLevel = remainingFlows.filter((f) => Math.abs(sourceCenterY(f) - tgtCenterY) <= 12);
      const remBelow = remainingFlows.filter((f) => sourceCenterY(f) > tgtCenterY + 12);

      remLevel.forEach((f, idx) => {
        if (!f.id) return;
        if (idx === 0 && !leftUsed) {
          gatewayInPortAssignments.set(f.id, { port: 'left', corridorOffset: 0 });
          leftUsed = true;
        } else if (topCount === 0) {
          gatewayInPortAssignments.set(f.id, { port: 'top', corridorOffset: topCount * 16 });
          topCount += 1;
        } else {
          gatewayInPortAssignments.set(f.id, { port: 'bottom', corridorOffset: bottomCount * 16 });
          bottomCount += 1;
        }
      });

      remAbove.forEach((f, idx) => {
        if (!f.id) return;
        if (topCount === 0 || (leftUsed && idx === 0)) {
          gatewayInPortAssignments.set(f.id, { port: 'top', corridorOffset: topCount * 16 });
          topCount += 1;
        } else if (!leftUsed) {
          gatewayInPortAssignments.set(f.id, { port: 'left', corridorOffset: 0 });
          leftUsed = true;
        } else {
          gatewayInPortAssignments.set(f.id, { port: 'top', corridorOffset: topCount * 16 });
          topCount += 1;
        }
      });

      remBelow.forEach((f, idx) => {
        if (!f.id) return;
        if (bottomCount === 0) {
          gatewayInPortAssignments.set(f.id, { port: 'bottom', corridorOffset: 0 });
          bottomCount += 1;
        } else if (!leftUsed && idx < remBelow.length) {
          gatewayInPortAssignments.set(f.id, { port: 'left', corridorOffset: 0 });
          leftUsed = true;
        } else {
          gatewayInPortAssignments.set(f.id, { port: 'bottom', corridorOffset: bottomCount * 16 });
          bottomCount += 1;
        }
      });
    }

    let backChannelIdx = 0;
    let topBackChannelIdx = 0;
    for (const flow of flows) {
      const id = flow.id as string;
      const srcId = flow.sourceRef?.id;
      const tgtId = flow.targetRef?.id;
      const src = srcId ? boxes.get(srcId) : undefined;
      const tgt = tgtId ? boxes.get(tgtId) : undefined;
      if (!src || !tgt || !srcId || !tgtId) continue;

      const isFromBoundary = boundaryEventIds.has(srcId);
      const bMeta = isFromBoundary ? boundarySlotMeta.get(srcId) : undefined;
      const portAssign = gatewayPortAssignments.get(id);
      const inPortAssign = gatewayInPortAssignments.get(id);
      const longSpan = longSpanSlotByFlowId.get(id);

      const sx =
        isFromBoundary || portAssign?.port === 'top' || portAssign?.port === 'bottom'
          ? Math.round(src.x + src.w / 2)
          : Math.round(src.x + src.w);
      const sy = isFromBoundary
        ? Math.round(src.y + src.h)
        : portAssign?.port === 'top'
          ? Math.round(src.y)
          : portAssign?.port === 'bottom'
            ? Math.round(src.y + src.h)
            : Math.round(src.y + src.h / 2);

      const tx =
        inPortAssign?.port === 'top' || inPortAssign?.port === 'bottom'
          ? Math.round(tgt.x + tgt.w / 2)
          : Math.round(tgt.x);
      const ty =
        inPortAssign?.port === 'top'
          ? Math.round(tgt.y)
          : inPortAssign?.port === 'bottom'
            ? Math.round(tgt.y + tgt.h)
            : Math.round(tgt.y + tgt.h / 2);

      const buildFinalArrival = (fromX: number, fromY: number): Point[] => {
        if (!inPortAssign || inPortAssign.port === 'left') {
          const clearTail = routeHorizontalClearance(fromX, tx, ty, srcId, tgtId);
          return fromY === ty
            ? [...clearTail, { x: tx, y: ty }]
            : [{ x: fromX, y: ty }, ...clearTail, { x: tx, y: ty }];
        }
        if (inPortAssign.port === 'top') {
          if (fromY <= ty - 8) {
            if (!findVerticalObstacle(tx, fromY, ty, srcId, tgtId)) {
              const clearHead = routeHorizontalClearance(fromX, tx, fromY, srcId, tgtId);
              return [...clearHead, { x: tx, y: fromY }, { x: tx, y: ty }];
            }
          }
          const approachY = ty - 20 - inPortAssign.corridorOffset;
          const approachX = Math.max(fromX + 12, tx - 28 - inPortAssign.corridorOffset);
          return [
            { x: approachX, y: fromY },
            { x: approachX, y: approachY },
            { x: tx, y: approachY },
            { x: tx, y: ty },
          ];
        }
        // inPortAssign.port === 'bottom'
        if (fromY >= ty + 8) {
          if (!findVerticalObstacle(tx, ty, fromY, srcId, tgtId)) {
            const clearHead = routeHorizontalClearance(fromX, tx, fromY, srcId, tgtId);
            return [...clearHead, { x: tx, y: fromY }, { x: tx, y: ty }];
          }
        }
        const approachY = ty + 20 + inPortAssign.corridorOffset;
        const approachX = Math.max(fromX + 12, tx - 28 - inPortAssign.corridorOffset);
        return [
          { x: approachX, y: fromY },
          { x: approachX, y: approachY },
          { x: tx, y: approachY },
          { x: tx, y: ty },
        ];
      };

      let waypoints: Point[];

      // Regla 6: Autopista perimetral para saltos largos (>= 3 columnas) evitando atravesar tareas/flujos
      if (longSpan && laneBoxesByIdx.has(longSpan.laneIdx) && tx >= sx - 4) {
        const tgtLaneBox = laneBoxesByIdx.get(longSpan.laneIdx)!;
        const highwayY =
          longSpan.highwayPos === 'bottom'
            ? Math.round(tgtLaneBox.y + tgtLaneBox.h - 14 - longSpan.slot * 14)
            : Math.round(tgtLaneBox.y + 14 + longSpan.slot * 14);

        let dropX =
          portAssign?.port === 'top' || portAssign?.port === 'bottom'
            ? sx
            : Math.round(sx + 22 + longSpan.slot * 12);
        const vertExitObs = findVerticalObstacle(dropX, sy, highwayY, srcId, tgtId);
        if (vertExitObs) {
          dropX = pickSideBypassX(vertExitObs, tx, sy, highwayY, srcId, tgtId);
        }

        const riseX =
          inPortAssign?.port === 'top' || inPortAssign?.port === 'bottom'
            ? tx
            : Math.round(tx - 24 - longSpan.slot * 12);

        const startSegs: Point[] =
          dropX === sx ? [{ x: sx, y: sy }] : [{ x: sx, y: sy }, { x: dropX, y: sy }];
        const endSegs: Point[] =
          riseX === tx
            ? [{ x: tx, y: highwayY }, { x: tx, y: ty }]
            : [
                { x: riseX, y: highwayY },
                { x: riseX, y: ty },
                { x: tx, y: ty },
              ];
        waypoints = [...startSegs, { x: dropX, y: highwayY }, ...endSegs];
      } else if (tx >= sx - 4) {
        if (isFromBoundary) {
          const indexFromRight = bMeta?.indexFromRight ?? 0;
          const bCount = bMeta?.count ?? 1;
          if (ty > sy + 6) {
            const blocking = findVerticalObstacle(sx, sy, ty, srcId, tgtId);
            if (blocking) {
              const bendBase = bCount >= 2 ? 34 : 14;
              const bendY = sy + bendBase + indexFromRight * 14;
              const baseRightX = Math.round(blocking.x + blocking.w + 16);
              const preferredOuterX = baseRightX + (bCount - 1 - indexFromRight) * 14;
              const cx =
                preferredOuterX < tx - 8 &&
                !findVerticalObstacle(preferredOuterX, bendY, ty, srcId, tgtId)
                  ? preferredOuterX
                  : pickSideBypassX(blocking, tx, bendY, ty, srcId, tgtId);
              const arrival = buildFinalArrival(cx, ty);
              waypoints = [
                { x: sx, y: sy },
                { x: sx, y: bendY },
                { x: cx, y: bendY },
                { x: cx, y: ty },
                ...arrival.slice(
                  arrival[0]?.x === cx && arrival[0]?.y === ty ? 1 : 0
                ),
              ];
            } else {
              const arrival = buildFinalArrival(sx, ty);
              waypoints = [{ x: sx, y: sy }, { x: sx, y: ty }, ...arrival];
            }
          } else {
            const bendY = sy + (bCount >= 2 ? 34 : 16) + indexFromRight * 14;
            let midX = Math.round(sx + Math.max(24, (tx - sx) / 2));
            const vertBlock = findVerticalObstacle(midX, bendY, ty, srcId, tgtId);
            if (vertBlock) {
              midX = pickSideBypassX(vertBlock, tx, bendY, ty, srcId, tgtId);
            }
            const arrival = buildFinalArrival(midX, ty);
            waypoints = [
              { x: sx, y: sy },
              { x: sx, y: bendY },
              { x: midX, y: bendY },
              { x: midX, y: ty },
              ...arrival,
            ];
          }
        } else if (portAssign?.port === 'top') {
          if (portAssign.corridorOffset === 0 && ty < sy - 6) {
            const blocking = findVerticalObstacle(sx, sy, ty, srcId, tgtId);
            if (blocking) {
              const bendY = sy - 14;
              const cx = pickSideBypassX(blocking, tx, bendY, ty, srcId, tgtId);
              waypoints = [
                { x: sx, y: sy },
                { x: sx, y: bendY },
                { x: cx, y: bendY },
                { x: cx, y: ty },
                ...buildFinalArrival(cx, ty),
              ];
            } else {
              waypoints = [{ x: sx, y: sy }, { x: sx, y: ty }, ...buildFinalArrival(sx, ty)];
            }
          } else {
            const bendY = sy - 16;
            const cx =
              portAssign.corridorOffset > 0
                ? sx + portAssign.corridorOffset
                : Math.round(src.x + src.w + Math.max(24, (tx - (src.x + src.w)) * 0.65));
            waypoints = [
              { x: sx, y: sy },
              { x: sx, y: bendY },
              { x: cx, y: bendY },
              ...buildFinalArrival(cx, bendY),
            ];
          }
        } else if (portAssign?.port === 'bottom') {
          if (portAssign.corridorOffset === 0) {
            const blocking = findVerticalObstacle(sx, sy, ty, srcId, tgtId);
            if (blocking) {
              const bendY = sy + 14;
              const cx = pickSideBypassX(blocking, tx, bendY, ty, srcId, tgtId);
              waypoints = [
                { x: sx, y: sy },
                { x: sx, y: bendY },
                { x: cx, y: bendY },
                { x: cx, y: ty },
                ...buildFinalArrival(cx, ty),
              ];
            } else {
              waypoints = [{ x: sx, y: sy }, { x: sx, y: ty }, ...buildFinalArrival(sx, ty)];
            }
          } else {
            const bendY = sy + 14;
            const cx = sx + portAssign.corridorOffset;
            waypoints = [
              { x: sx, y: sy },
              { x: sx, y: bendY },
              { x: cx, y: bendY },
              ...buildFinalArrival(cx, bendY),
            ];
          }
        } else if (
          (inPortAssign?.port === 'top' && sy <= ty - 8) ||
          (inPortAssign?.port === 'bottom' && sy >= ty + 8)
        ) {
          // Entrada directa en L limpia al vértice superior o inferior de una compuerta convergente
          const horizClear = routeHorizontalClearance(sx, tx, sy, srcId, tgtId);
          const vertBlocked = findVerticalObstacle(tx, sy, ty, srcId, tgtId);
          if (!vertBlocked) {
            waypoints = [{ x: sx, y: sy }, ...horizClear, { x: tx, y: sy }, { x: tx, y: ty }];
          } else {
            const bypassX = pickSideBypassX(vertBlocked, tx + 24, sy, ty, srcId, tgtId);
            const standOffY = inPortAssign.port === 'top' ? ty - 18 : ty + 18;
            waypoints = [
              { x: sx, y: sy },
              { x: bypassX, y: sy },
              { x: bypassX, y: standOffY },
              { x: tx, y: standOffY },
              { x: tx, y: ty },
            ];
          }
        } else if (Math.abs(sy - ty) <= 4 && (!inPortAssign || inPortAssign.port === 'left')) {
          const midClearance = routeHorizontalClearance(
            sx,
            tx,
            Math.round((sy + ty) / 2),
            srcId,
            tgtId
          );
          waypoints = [{ x: sx, y: sy }, ...midClearance, { x: tx, y: ty }];
        } else {
          let midX = Math.round(sx + Math.max(24, Math.min(48, (tx - sx) * 0.35)));
          const vertBlock = findVerticalObstacle(midX, sy, ty, srcId, tgtId);
          if (vertBlock) {
            midX = pickSideBypassX(vertBlock, tx, sy, ty, srcId, tgtId);
          }
          const headClearance = routeHorizontalClearance(sx, midX, sy, srcId, tgtId);
          waypoints = [
            { x: sx, y: sy },
            ...headClearance,
            { x: midX, y: sy },
            ...buildFinalArrival(midX, sy),
          ];
        }
      } else {
        const sameColumn = Math.abs(src.x + src.w / 2 - (tgt.x + tgt.w / 2)) <= 14;
        if (sameColumn) {
          let corridorX = Math.round(Math.max(src.x + src.w, tgt.x + tgt.w) + 22);
          while (findVerticalObstacle(corridorX, sy, ty, srcId, tgtId)) {
            corridorX += 16;
          }
          const startY = Math.round(src.y + src.h / 2);
          const endRightY = Math.round(tgt.y + tgt.h / 2);
          waypoints = [
            { x: Math.round(src.x + src.w), y: startY },
            { x: corridorX, y: startY },
            { x: corridorX, y: endRightY },
            { x: Math.round(tgt.x + tgt.w), y: endRightY },
          ];
        } else {
          const srcLaneIdx = laneIndexByNodeId.get(srcId);
          const tgtLaneIdx = laneIndexByNodeId.get(tgtId);
          const srcLaneBox = srcLaneIdx !== undefined ? laneBoxesByIdx.get(srcLaneIdx) : undefined;
          const startMidX = Math.round(src.x + src.w / 2);
          const targetMidX = Math.round(tgt.x + tgt.w / 2);

          // Regla 7: Si el bucle de retorno está despejado por arriba dentro del mismo carril, rutear por el canal superior
          const candidateTopY = Math.round(Math.min(src.y, tgt.y) - 24 - topBackChannelIdx * 14);
          const canRouteTop =
            srcLaneIdx !== undefined &&
            srcLaneIdx === tgtLaneIdx &&
            srcLaneBox !== undefined &&
            candidateTopY >= srcLaneBox.y + 10 &&
            findAllHorizontalObstacles(candidateTopY, targetMidX, startMidX, srcId, tgtId).length === 0 &&
            !findVerticalObstacle(startMidX, src.y, candidateTopY, srcId, tgtId) &&
            !findVerticalObstacle(targetMidX, tgt.y, candidateTopY, srcId, tgtId);

          if (canRouteTop) {
            topBackChannelIdx += 1;
            waypoints = [
              { x: startMidX, y: Math.round(src.y) },
              { x: startMidX, y: candidateTopY },
              { x: targetMidX, y: candidateTopY },
              { x: targetMidX, y: Math.round(tgt.y) },
            ];
          } else {
            const baseY = Math.max(src.y + src.h, tgt.y + tgt.h);
            const routeY = Math.round(
              Math.min(poolBottomY - 12, baseY + 22 + backChannelIdx * 18)
            );
            backChannelIdx += 1;
            const dropBlock = findVerticalObstacle(
              startMidX,
              src.y + src.h,
              routeY,
              srcId,
              tgtId
            );
            const riseBlock = findVerticalObstacle(
              targetMidX,
              tgt.y + tgt.h,
              routeY,
              srcId,
              tgtId
            );

            const startPts: Point[] = dropBlock
              ? [
                  { x: Math.round(src.x + src.w), y: Math.round(src.y + src.h / 2) },
                  { x: Math.round(src.x + src.w + 16), y: Math.round(src.y + src.h / 2) },
                  { x: Math.round(src.x + src.w + 16), y: routeY },
                ]
              : [
                  { x: startMidX, y: Math.round(src.y + src.h) },
                  { x: startMidX, y: routeY },
                ];

            const endPts: Point[] = riseBlock
              ? [
                  { x: Math.round(tgt.x - 16), y: routeY },
                  { x: Math.round(tgt.x - 16), y: ty },
                  { x: Math.round(tgt.x), y: ty },
                ]
              : [
                  { x: targetMidX, y: routeY },
                  { x: targetMidX, y: Math.round(tgt.y + tgt.h) },
                ];

            waypoints = [...startPts, ...endPts];
          }
        }
      }

      // Deduplicar waypoints colineales o idénticos consecutivos
      const deduped: Point[] = [];
      for (const wp of waypoints) {
        const last = deduped[deduped.length - 1];
        if (!last || last.x !== wp.x || last.y !== wp.y) {
          deduped.push(wp);
        }
      }

      const wpXml = deduped
        .map((wp) => `        <omgdi:waypoint x="${wp.x}" y="${wp.y}" />`)
        .join('\n');
      edgeXmlParts.push(
        `      <bpmndi:BPMNEdge id="${id}_di" bpmnElement="${id}">\n${wpXml}\n      </bpmndi:BPMNEdge>`
      );
    }

    currentY = poolStartY + poolHeight + POOL_GAP_Y;
  }

  const mfSlotByFlowId = new Map<string, { slotIdx: number; groupCount: number }>();
  const mfGroups = new Map<string, Array<{ mf: CollabMessageFlow; idx: number; isFromNarrow: boolean }>>();
  messageFlows.forEach((mf, idx) => {
    const srcId = mf.sourceRef?.id;
    const tgtId = mf.targetRef?.id;
    const src = srcId ? boxes.get(srcId) : undefined;
    const tgt = tgtId ? boxes.get(tgtId) : undefined;
    if (!mf.id || !srcId || !tgtId || !src || !tgt) return;
    const pairKey = [srcId, tgtId].sort().join('||');
    const list = mfGroups.get(pairKey) || [];
    list.push({ mf, idx, isFromNarrow: src.w <= 300 });
    mfGroups.set(pairKey, list);
  });
  for (const group of mfGroups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => Number(b.isFromNarrow) - Number(a.isFromNarrow) || a.idx - b.idx);
    group.forEach((entry, slotIdx) => {
      if (entry.mf.id) {
        mfSlotByFlowId.set(entry.mf.id, { slotIdx, groupCount: group.length });
      }
    });
  }

  messageFlows.forEach((mf, idx) => {
    const id = mf.id;
    const srcId = mf.sourceRef?.id;
    const tgtId = mf.targetRef?.id;
    const src = srcId ? boxes.get(srcId) : undefined;
    const tgt = tgtId ? boxes.get(tgtId) : undefined;
    if (!id || !srcId || !tgtId || !src || !tgt) return;

    const srcCenterX = src.x + src.w / 2;
    const tgtCenterX = tgt.x + tgt.w / 2;
    const srcCenterY = src.y + src.h / 2;
    const tgtCenterY = tgt.y + tgt.h / 2;
    const goingDown = tgtCenterY >= srcCenterY;

    const isSrcWidePool = src.w > 300;
    const isTgtWidePool = tgt.w > 300;

    const mfSlot = mfSlotByFlowId.get(id);
    const groupCount = mfSlot?.groupCount ?? 1;
    const slotIdx = mfSlot?.slotIdx ?? 0;

    let sx = Math.round(srcCenterX);
    let tx = Math.round(tgtCenterX);
    if (groupCount >= 2 && !(isSrcWidePool && isTgtWidePool)) {
      const narrowW = !isSrcWidePool ? src.w : tgt.w;
      const halfLimit = Math.max(8, Math.floor(narrowW / 2) - 10);
      const desiredStep = Math.min(44, Math.floor((halfLimit * 2) / Math.max(1, groupCount - 1)));
      const offsetX = Math.round((slotIdx - (groupCount - 1) / 2) * desiredStep);
      if (!isSrcWidePool) sx += offsetX;
      if (!isTgtWidePool) tx += offsetX;
    }

    if (isSrcWidePool && !isTgtWidePool) sx = tx;
    if (isTgtWidePool && !isSrcWidePool) tx = sx;
    if (isSrcWidePool && isTgtWidePool) {
      sx = Math.round(src.x + 120 + idx * 80);
      tx = sx;
    }

    const sy = Math.round(goingDown ? src.y + src.h : src.y);
    const ty = Math.round(goingDown ? tgt.y : tgt.y + tgt.h);

    let waypoints: Point[];
    const directBlocking =
      Math.abs(sx - tx) <= 6 ? findVerticalObstacle(sx, sy, ty, srcId, tgtId) : undefined;

    if (directBlocking) {
      const sideStartY = isSrcWidePool ? sy : Math.round(srcCenterY);
      const sideEndY = isTgtWidePool ? ty : Math.round(tgtCenterY);
      const rawCandidates = [
        Math.round(Math.max(src.x + src.w, directBlocking.x + directBlocking.w) + 24 + idx * 14),
        Math.round(Math.min(src.x, directBlocking.x) - 24 - idx * 14),
        Math.round(directBlocking.x + directBlocking.w + 24 + idx * 14),
        Math.round(directBlocking.x - 24 - idx * 14),
        Math.round(POOL_X + uniformPoolWidth - 24 - idx * 14),
      ];
      const candidates = rawCandidates.filter(
        (cx) => cx >= POOL_X + 12 && cx <= POOL_X + uniformPoolWidth - 12
      );
      const chosenCorridorX =
        candidates.find((cx) => !findVerticalObstacle(cx, sideStartY, sideEndY, srcId, tgtId)) ??
        candidates[0] ??
        sx + 60;

      if (!isSrcWidePool && isTgtWidePool) {
        const exitX = chosenCorridorX >= srcCenterX ? Math.round(src.x + src.w) : Math.round(src.x);
        waypoints = [
          { x: exitX, y: sideStartY },
          { x: chosenCorridorX, y: sideStartY },
          { x: chosenCorridorX, y: ty },
        ];
      } else if (isSrcWidePool && !isTgtWidePool) {
        const entryX =
          chosenCorridorX >= tgtCenterX ? Math.round(tgt.x + tgt.w) : Math.round(tgt.x);
        waypoints = [
          { x: chosenCorridorX, y: sy },
          { x: chosenCorridorX, y: sideEndY },
          { x: entryX, y: sideEndY },
        ];
      } else {
        const exitX = chosenCorridorX >= srcCenterX ? Math.round(src.x + src.w) : Math.round(src.x);
        const entryX =
          chosenCorridorX >= tgtCenterX ? Math.round(tgt.x + tgt.w) : Math.round(tgt.x);
        waypoints = [
          { x: exitX, y: sideStartY },
          { x: chosenCorridorX, y: sideStartY },
          { x: chosenCorridorX, y: sideEndY },
          { x: entryX, y: sideEndY },
        ];
      }
    } else if (Math.abs(sx - tx) <= 6) {
      waypoints = [
        { x: sx, y: sy },
        { x: sx, y: ty },
      ];
    } else {
      const blockingSrcCol = findVerticalObstacle(sx, sy, Math.round((sy + ty) / 2), srcId, tgtId);
      const blockingTgtCol = findVerticalObstacle(tx, Math.round((sy + ty) / 2), ty, srcId, tgtId);
      if (blockingSrcCol || blockingTgtCol) {
        const sideStartY = isSrcWidePool ? sy : Math.round(srcCenterY);
        const sideEndY = isTgtWidePool ? ty : Math.round(tgtCenterY);
        const block = blockingSrcCol || blockingTgtCol!;
        const candRight = Math.round(block.x + block.w + 24 + idx * 14);
        const candLeft = Math.round(block.x - 24 - idx * 14);
        const corridorX = !findVerticalObstacle(candRight, sideStartY, sideEndY, srcId, tgtId)
          ? candRight
          : candLeft;
        const exitX = isSrcWidePool
          ? corridorX
          : corridorX >= srcCenterX
            ? Math.round(src.x + src.w)
            : Math.round(src.x);
        const entryX = isTgtWidePool
          ? corridorX
          : corridorX >= tgtCenterX
            ? Math.round(tgt.x + tgt.w)
            : Math.round(tgt.x);
        waypoints = [
          { x: exitX, y: sideStartY },
          { x: corridorX, y: sideStartY },
          { x: corridorX, y: sideEndY },
          { x: entryX, y: sideEndY },
        ];
      } else {
        const midY = Math.round((sy + ty) / 2);
        waypoints = [
          { x: sx, y: sy },
          { x: sx, y: midY },
          { x: tx, y: midY },
          { x: tx, y: ty },
        ];
      }
    }

    const wpXml = waypoints
      .map((wp) => `        <omgdi:waypoint x="${wp.x}" y="${wp.y}" />`)
      .join('\n');
    let mfLabelXml = '';
    if (groupCount >= 2 && mf.name) {
      const labelAnchorX = waypoints[Math.min(1, waypoints.length - 1)]?.x ?? sx;
      const midCenter = (groupCount - 1) / 2;
      const labelW = 92;
      const labelX =
        slotIdx < midCenter
          ? Math.round(labelAnchorX - labelW - 8)
          : slotIdx > midCenter
            ? Math.round(labelAnchorX + 8)
            : Math.round(labelAnchorX - labelW / 2);
      const labelY = Math.round((sy + ty) / 2 - 14 + (slotIdx % 2 === 0 ? -18 : 12));
      mfLabelXml =
        `\n        <bpmndi:BPMNLabel>\n` +
        `          <omgdc:Bounds x="${labelX}" y="${labelY}" width="${labelW}" height="28" />\n` +
        `        </bpmndi:BPMNLabel>`;
    }
    edgeXmlParts.push(
      `      <bpmndi:BPMNEdge id="${id}_di" bpmnElement="${id}">\n${wpXml}${mfLabelXml}\n      </bpmndi:BPMNEdge>`
    );
  });

  const planeTargetId =
    collaboration?.id || Array.from(processById.keys())[0] || 'Process_1';

  const diagramXml = `  <bpmndi:BPMNDiagram id="BPMNDiagram_Collab">
    <bpmndi:BPMNPlane id="BPMNPlane_Collab" bpmnElement="${planeTargetId}">
${shapeXmlParts.filter(Boolean).join('\n')}
${edgeXmlParts.join('\n')}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>`;

  const withNs = ensureDiNamespaces(cleanXml);
  return withNs.replace(/<\/bpmn:definitions>/i, `${diagramXml}\n</bpmn:definitions>`);
}
