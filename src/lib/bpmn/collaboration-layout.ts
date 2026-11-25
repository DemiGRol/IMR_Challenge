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

const POOL_X = 120;
const POOL_START_Y = 80;
const POOL_HEADER_W = 30;
const LANE_HEADER_W = 30;
const POOL_GAP_Y = 76;
const BLACKBOX_H = 72;
const COL_GAP = 165;
const SUBROW_GAP = 115;
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
): Map<string, number> {
  const adjacency = new Map<string, string[]>();
  const incomingCount = new Map<string, number>();
  const boundariesByHost = new Map<string, string[]>();

  for (const n of nodes) {
    if (n.id) incomingCount.set(n.id, 0);
    if (n.$type === 'bpmn:BoundaryEvent' && n.id && n.attachedToRef?.id) {
      const list = boundariesByHost.get(n.attachedToRef.id) || [];
      list.push(n.id);
      boundariesByHost.set(n.attachedToRef.id, list);
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

  const colById = new Map<string, number>();
  const queue: string[] = [];

  for (const n of nodes) {
    if (
      n.id &&
      n.$type !== 'bpmn:BoundaryEvent' &&
      (n.$type === 'bpmn:StartEvent' || incomingCount.get(n.id) === 0)
    ) {
      if (!colById.has(n.id)) {
        colById.set(n.id, 0);
        queue.push(n.id);
      }
    }
  }

  while (queue.length > 0) {
    const curr = queue.shift() as string;
    const currCol = colById.get(curr) ?? 0;
    for (const next of adjacency.get(curr) || []) {
      if (!colById.has(next)) {
        colById.set(next, currCol + 1);
        queue.push(next);
      }
    }
    for (const bId of boundariesByHost.get(curr) || []) {
      if (!colById.has(bId)) {
        colById.set(bId, currCol);
        queue.push(bId);
      }
    }
  }

  let maxCol = 0;
  for (const c of colById.values()) {
    if (c > maxCol) maxCol = c;
  }
  for (const n of nodes) {
    if (n.id && !colById.has(n.id)) {
      maxCol += 1;
      colById.set(n.id, maxCol);
    }
  }

  return colById;
}

/**
 * Layouter determinista de Colaboración y Swimlanes BPMN 2.0 (Pools white-box/black-box,
 * Lanes horizontales, nodos por columna BFS, sequenceFlows ortogonales y messageFlows).
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

  const participants: Array<{ participant?: CollabParticipant; process?: CollabProcess }> = [];
  if (collaboration && collaboration.participants && collaboration.participants.length > 0) {
    for (const part of collaboration.participants) {
      const proc = part.processRef?.id ? processById.get(part.processRef.id) : undefined;
      participants.push({ participant: part, process: proc });
    }
  } else {
    for (const proc of processById.values()) {
      participants.push({ process: proc });
    }
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

    const colById = computeTopologicalColumns(nodes, flows);
    let maxCol = 0;
    for (const c of colById.values()) {
      if (c > maxCol) maxCol = c;
    }
    if (maxCol > globalMaxCol) globalMaxCol = maxCol;

    const lanes = (proc.laneSets || [])
      .flatMap((ls) => ls.lanes || [])
      .filter((l) => Boolean(l.id));
    processMetrics.set(proc.id, { nodes, flows, colById, maxCol, lanes });
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
    const boundaryNodes = nodes.filter((n) => n.$type === 'bpmn:BoundaryEvent' && n.id);
    const gridNodes = nodes.filter((n) => n.$type !== 'bpmn:BoundaryEvent');
    const boundaryEventIds = new Set(boundaryNodes.map((b) => b.id as string));
    const boundariesByHostId = new Map<string, CollabFlowElement[]>();
    for (const b of boundaryNodes) {
      const hostId = b.attachedToRef?.id;
      if (!hostId) continue;
      const list = boundariesByHostId.get(hostId) || [];
      list.push(b);
      boundariesByHostId.set(hostId, list);
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
    const hasBoundaryIncoming = new Set<string>();
    const hasNormalIncoming = new Set<string>();
    for (const flow of flows) {
      const src = flow.sourceRef?.id;
      const tgt = flow.targetRef?.id;
      if (!src || !tgt) continue;
      const list = outgoingTargetsByNodeId.get(src) || [];
      list.push(tgt);
      outgoingTargetsByNodeId.set(src, list);
      if (boundaryEventIds.has(src)) {
        hasBoundaryIncoming.add(tgt);
      } else {
        hasNormalIncoming.add(tgt);
      }
    }

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

    const poolShapeSlotIdx = shapeXmlParts.length;
    if (part?.id) {
      shapeXmlParts.push('');
    }

    let laneY = poolStartY;
    let poolBottomY = poolStartY;

    for (const [laneIdx, group] of laneGroups.entries()) {
      const byCol = new Map<number, CollabFlowElement[]>();
      let maxSubRows = 1;
      for (const node of group.nodes) {
        const col = colById.get(node.id as string) ?? 0;
        const list = byCol.get(col) || [];
        list.push(node);
        byCol.set(col, list);
        if (list.length > maxSubRows) maxSubRows = list.length;
      }

      const hasBoundariesInGroup = group.nodes.some(
        (n) => n.id && (boundariesByHostId.get(n.id)?.length || 0) > 0
      );
      const laneHeight = Math.max(
        130,
        LANE_PAD_Y * 2 + (maxSubRows - 1) * SUBROW_GAP + 80 + (hasBoundariesInGroup ? 24 : 0)
      );

      if (group.lane?.id) {
        const laneBox: Box = { x: laneOffsetX, y: laneY, w: laneWidth, h: laneHeight };
        boxes.set(group.lane.id, laneBox);
        shapeXmlParts.push(
          `      <bpmndi:BPMNShape id="${group.lane.id}_di" bpmnElement="${group.lane.id}" isHorizontal="true">\n` +
            `        <omgdc:Bounds x="${laneBox.x}" y="${laneBox.y}" width="${laneBox.w}" height="${laneBox.h}" />\n` +
            `      </bpmndi:BPMNShape>`
        );
      }

      for (const [col, colNodes] of byCol.entries()) {
        if (colNodes.length > 1) {
          colNodes.sort(
            (a, b) =>
              verticalGravity(a.id as string, laneIdx) - verticalGravity(b.id as string, laneIdx)
          );
        }
        colNodes.forEach((node, subRow) => {
          const id = node.id as string;
          const { w, h } = getNodeSize(node.$type);
          const cellX = nodeBaseX + col * COL_GAP;
          const cellY = laneY + LANE_PAD_Y + subRow * SUBROW_GAP;
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

          const attached = boundariesByHostId.get(id);
          if (attached && attached.length > 0) {
            attached.forEach((bNode, idx) => {
              const bId = bNode.id as string;
              const bw = 36;
              const bh = 36;
              const cx =
                attached.length === 1
                  ? x + w / 2
                  : x + 22 + (idx * Math.max(0, w - 44)) / (attached.length - 1);
              const bx = Math.round(cx - bw / 2);
              const by = Math.round(y + h - bh / 2);
              const bBox: Box = { x: bx, y: by, w: bw, h: bh };
              boxes.set(bId, bBox);
              obstacleBoxes.push({ id: bId, box: bBox });
              shapeXmlParts.push(
                `      <bpmndi:BPMNShape id="${bId}_di" bpmnElement="${bId}">\n` +
                  `        <omgdc:Bounds x="${bx}" y="${by}" width="${bw}" height="${bh}" />\n` +
                  `      </bpmndi:BPMNShape>`
              );
            });
          }
        });
      }

      laneY += laneHeight;
      poolBottomY = laneY;
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

    const nodeTypeById = new Map<string, string>();
    for (const n of nodes) {
      if (n.id) nodeTypeById.set(n.id, n.$type);
    }

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

    type GatewayPort = 'top' | 'right' | 'bottom';
    const gatewayPortAssignments = new Map<
      string,
      { port: GatewayPort; corridorOffset: number }
    >();

    for (const [srcId, gwFlows] of gatewayForwardFlows.entries()) {
      if (gwFlows.length < 2) continue;
      const srcBox = boxes.get(srcId)!;
      const srcCenterY = srcBox.y + srcBox.h / 2;
      const targetCenterY = (f: CollabFlowElement): number => {
        const tb = f.targetRef?.id ? boxes.get(f.targetRef.id) : undefined;
        return tb ? tb.y + tb.h / 2 : srcCenterY;
      };

      const sorted = [...gwFlows].sort((a, b) => targetCenterY(a) - targetCenterY(b));
      if (sorted.length === 3) {
        if (sorted[0].id) gatewayPortAssignments.set(sorted[0].id, { port: 'top', corridorOffset: 0 });
        if (sorted[1].id) gatewayPortAssignments.set(sorted[1].id, { port: 'right', corridorOffset: 0 });
        if (sorted[2].id) gatewayPortAssignments.set(sorted[2].id, { port: 'bottom', corridorOffset: 0 });
        continue;
      }

      const up = sorted.filter((f) => targetCenterY(f) < srcCenterY - 12);
      const straight = sorted.filter((f) => Math.abs(targetCenterY(f) - srcCenterY) <= 12);
      const down = sorted.filter((f) => targetCenterY(f) > srcCenterY + 12);

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

    let backChannelIdx = 0;
    for (const flow of flows) {
      const id = flow.id as string;
      const srcId = flow.sourceRef?.id;
      const tgtId = flow.targetRef?.id;
      const src = srcId ? boxes.get(srcId) : undefined;
      const tgt = tgtId ? boxes.get(tgtId) : undefined;
      if (!src || !tgt || !srcId || !tgtId) continue;

      const isFromBoundary = boundaryEventIds.has(srcId);
      const portAssign = gatewayPortAssignments.get(id);
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
      const tx = Math.round(tgt.x);
      const ty = Math.round(tgt.y + tgt.h / 2);

      let waypoints: Array<{ x: number; y: number }>;
      if (tx >= sx - 4) {
        if (isFromBoundary) {
          if (ty > sy + 6) {
            const blocking = findVerticalObstacle(sx, sy, ty, srcId, tgtId);
            if (blocking) {
              const bendY = sy + 14;
              const cx = pickSideBypassX(blocking, tx, bendY, ty, srcId, tgtId);
              waypoints = [
                { x: sx, y: sy },
                { x: sx, y: bendY },
                { x: cx, y: bendY },
                { x: cx, y: ty },
                { x: tx, y: ty },
              ];
            } else {
              waypoints = [
                { x: sx, y: sy },
                { x: sx, y: ty },
                { x: tx, y: ty },
              ];
            }
          } else {
            const bendY = sy + 20;
            const midX = Math.round(sx + Math.max(24, (tx - sx) / 2));
            waypoints = [
              { x: sx, y: sy },
              { x: sx, y: bendY },
              { x: midX, y: bendY },
              { x: midX, y: ty },
              { x: tx, y: ty },
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
                { x: tx, y: ty },
              ];
            } else {
              waypoints = [
                { x: sx, y: sy },
                { x: sx, y: ty },
                { x: tx, y: ty },
              ];
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
              { x: cx, y: ty },
              { x: tx, y: ty },
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
                { x: tx, y: ty },
              ];
            } else {
              waypoints = [
                { x: sx, y: sy },
                { x: sx, y: ty },
                { x: tx, y: ty },
              ];
            }
          } else {
            const bendY = sy + 14;
            const cx = sx + portAssign.corridorOffset;
            waypoints = [
              { x: sx, y: sy },
              { x: sx, y: bendY },
              { x: cx, y: bendY },
              { x: cx, y: ty },
              { x: tx, y: ty },
            ];
          }
        } else if (Math.abs(sy - ty) <= 4) {
          waypoints = [
            { x: sx, y: sy },
            { x: tx, y: ty },
          ];
        } else {
          const midX = Math.round(sx + Math.max(24, (tx - sx) * 0.35));
          waypoints = [
            { x: sx, y: sy },
            { x: midX, y: sy },
            { x: midX, y: ty },
            { x: tx, y: ty },
          ];
        }
      } else {
        const baseY = Math.max(src.y + src.h, tgt.y + tgt.h);
        const routeY = Math.round(Math.min(poolBottomY - 12, baseY + 22 + backChannelIdx * 18));
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
      edgeXmlParts.push(
        `      <bpmndi:BPMNEdge id="${id}_di" bpmnElement="${id}">\n${wpXml}\n      </bpmndi:BPMNEdge>`
      );
    }

    currentY = poolStartY + poolHeight + POOL_GAP_Y;
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

    let sx = Math.round(srcCenterX);
    let tx = Math.round(tgtCenterX);
    if (isSrcWidePool && !isTgtWidePool) sx = tx;
    if (isTgtWidePool && !isSrcWidePool) tx = sx;
    if (isSrcWidePool && isTgtWidePool) {
      sx = Math.round(src.x + 120 + idx * 80);
      tx = sx;
    }

    const sy = Math.round(goingDown ? src.y + src.h : src.y);
    const ty = Math.round(goingDown ? tgt.y : tgt.y + tgt.h);

    let waypoints: Array<{ x: number; y: number }>;
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
    edgeXmlParts.push(
      `      <bpmndi:BPMNEdge id="${id}_di" bpmnElement="${id}">\n${wpXml}\n      </bpmndi:BPMNEdge>`
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
