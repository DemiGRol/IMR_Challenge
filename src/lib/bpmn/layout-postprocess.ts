interface Waypoint {
  x: number;
  y: number;
}

interface ParsedEdge {
  fullMatch: string;
  startIndex: number;
  endIndex: number;
  waypoints: Waypoint[];
}

interface HorizontalSegment {
  edgeIdx: number;
  wpIdx: number;
  minX: number;
  maxX: number;
  y: number;
}

interface VerticalSegment {
  edgeIdx: number;
  wpIdx: number;
  minY: number;
  maxY: number;
  x: number;
}

const LANE_GAP_PX = 26;
const Y_TOLERANCE_PX = 6;
const X_MARGIN_PX = 12;
const CORRIDOR_GAP_PX = 16;
const X_TOLERANCE_PX = 6;
const Y_MARGIN_PX = 12;

function extractWaypoints(edgeXml: string): Waypoint[] {
  const waypoints: Waypoint[] = [];
  const wpRegex = /<(?:[a-zA-Z0-9_-]+:)?waypoint\b[^>]*>/g;
  let match: RegExpExecArray | null;
  while ((match = wpRegex.exec(edgeXml)) !== null) {
    const tag = match[0];
    const xMatch = /\bx="(-?\d+(?:\.\d+)?)"/.exec(tag);
    const yMatch = /\by="(-?\d+(?:\.\d+)?)"/.exec(tag);
    if (xMatch && yMatch) {
      waypoints.push({ x: Number(xMatch[1]), y: Number(yMatch[1]) });
    }
  }
  return waypoints;
}

function replaceWaypoints(edgeXml: string, waypoints: Waypoint[], labelDeltaY: number): string {
  let wpIndex = 0;
  let updated = edgeXml.replace(/<(?:[a-zA-Z0-9_-]+:)?waypoint\b[^>]*>/g, (tag) => {
    const wp = waypoints[wpIndex++];
    if (!wp) return tag;
    return tag
      .replace(/\bx="(-?\d+(?:\.\d+)?)"/, `x="${Math.round(wp.x)}"`)
      .replace(/\by="(-?\d+(?:\.\d+)?)"/, `y="${Math.round(wp.y)}"`);
  });

  if (labelDeltaY !== 0) {
    updated = updated.replace(
      /(<(?:[a-zA-Z0-9_-]+:)?BPMNLabel\b[^>]*>[\s\S]*?<(?:[a-zA-Z0-9_-]+:)?Bounds\b[^>]*\by=")(-?\d+(?:\.\d+)?)(")/,
      (_m, prefix: string, yStr: string, suffix: string) =>
        `${prefix}${Math.round(Number(yStr) + labelDeltaY)}${suffix}`
    );
  }
  return updated;
}

/**
 * Post-procesa el XML con DI generado por bpmn-auto-layout para separar
 * canales horizontales superpuestos en flujos de retorno (bucles) y desvíos.
 */
export function separateOverlappingEdges(layoutedXml: string): string {
  const edgeRegex = /<(?:[a-zA-Z0-9_-]+:)?BPMNEdge\b[\s\S]*?<\/(?:[a-zA-Z0-9_-]+:)?BPMNEdge>/g;
  const edges: ParsedEdge[] = [];
  let match: RegExpExecArray | null;

  while ((match = edgeRegex.exec(layoutedXml)) !== null) {
    edges.push({
      fullMatch: match[0],
      startIndex: match.index,
      endIndex: match.index + match[0].length,
      waypoints: extractWaypoints(match[0]),
    });
  }

  // Detectar segmentos horizontales intermedios (desvíos/bucles de >= 4 waypoints)
  const segments: HorizontalSegment[] = [];
  const verticalSegments: VerticalSegment[] = [];
  edges.forEach((edge, edgeIdx) => {
    if (edge.waypoints.length < 4) return;
    for (let i = 1; i < edge.waypoints.length - 2; i++) {
      const a = edge.waypoints[i];
      const b = edge.waypoints[i + 1];
      if (Math.abs(a.y - b.y) <= 1 && Math.abs(a.x - b.x) > 5) {
        segments.push({
          edgeIdx,
          wpIdx: i,
          minX: Math.min(a.x, b.x),
          maxX: Math.max(a.x, b.x),
          y: (a.y + b.y) / 2,
        });
      }
      if (Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) > 8) {
        verticalSegments.push({
          edgeIdx,
          wpIdx: i,
          minY: Math.min(a.y, b.y),
          maxY: Math.max(a.y, b.y),
          x: (a.x + b.x) / 2,
        });
      }
    }
  });

  const modifiedEdges = new Set<number>();
  const edgeDeltaY = new Map<number, number>();

  if (segments.length >= 2) {
    // Agrupar segmentos que comparten la misma altura Y (±6px)
    const bands: HorizontalSegment[][] = [];
    for (const seg of segments) {
      const band = bands.find((b) => Math.abs(b[0].y - seg.y) <= Y_TOLERANCE_PX);
      if (band) {
        band.push(seg);
      } else {
        bands.push([seg]);
      }
    }

    for (const band of bands) {
      if (band.length < 2) continue;
      // Ordenar por inicio X para asignar carriles sin solapamiento (interval graph coloring)
      band.sort((a, b) => a.minX - b.minX);
      const laneEndX: number[] = [];

      for (const seg of band) {
        let lane = laneEndX.findIndex((endX) => endX + X_MARGIN_PX < seg.minX);
        if (lane === -1) {
          lane = laneEndX.length;
          laneEndX.push(seg.maxX);
        } else {
          laneEndX[lane] = seg.maxX;
        }

        if (lane > 0) {
          const edge = edges[seg.edgeIdx];
          const firstY = edge.waypoints[0].y;
          const direction = seg.y >= firstY ? 1 : -1;
          const deltaY = direction * lane * LANE_GAP_PX;
          edge.waypoints[seg.wpIdx].y += deltaY;
          edge.waypoints[seg.wpIdx + 1].y += deltaY;
          edgeDeltaY.set(seg.edgeIdx, deltaY);
          modifiedEdges.add(seg.edgeIdx);
        }
      }
    }
  }

  if (verticalSegments.length >= 2) {
    // Segunda pasada: separar segmentos verticales intermedios que comparten corredor X (±6px)
    const xBands: VerticalSegment[][] = [];
    for (const seg of verticalSegments) {
      const band = xBands.find((b) => Math.abs(b[0].x - seg.x) <= X_TOLERANCE_PX);
      if (band) {
        band.push(seg);
      } else {
        xBands.push([seg]);
      }
    }

    for (const band of xBands) {
      if (band.length < 2) continue;
      band.sort((a, b) => a.minY - b.minY);
      const corridorEndY: number[] = [];

      for (const seg of band) {
        let corridor = corridorEndY.findIndex((endY) => endY + Y_MARGIN_PX < seg.minY);
        if (corridor === -1) {
          corridor = corridorEndY.length;
          corridorEndY.push(seg.maxY);
        } else {
          corridorEndY[corridor] = seg.maxY;
        }

        if (corridor > 0) {
          const edge = edges[seg.edgeIdx];
          const firstX = edge.waypoints[0].x;
          const lastX = edge.waypoints[edge.waypoints.length - 1].x;
          const segX = edge.waypoints[seg.wpIdx].x;
          let deltaX: number;
          if (firstX < lastX && segX - CORRIDOR_GAP_PX <= firstX + 12) {
            deltaX = corridor * 14;
          } else {
            const step = Math.ceil(corridor / 2);
            const sign = corridor % 2 === 1 ? 1 : -1;
            deltaX = sign * step * CORRIDOR_GAP_PX;
          }
          edge.waypoints[seg.wpIdx].x += deltaX;
          edge.waypoints[seg.wpIdx + 1].x += deltaX;
          modifiedEdges.add(seg.edgeIdx);
        }
      }
    }
  }

  if (modifiedEdges.size === 0) return layoutedXml;

  // Reconstruir XML reemplazando solo los BPMNEdge modificados de atrás hacia adelante
  let result = layoutedXml;
  for (let i = edges.length - 1; i >= 0; i--) {
    if (!modifiedEdges.has(i)) continue;
    const edge = edges[i];
    const delta = edgeDeltaY.get(i) ?? 0;
    const updatedEdge = replaceWaypoints(edge.fullMatch, edge.waypoints, delta);
    result = result.slice(0, edge.startIndex) + updatedEdge + result.slice(edge.endIndex);
  }

  return result;
}
