'use client';

import { MutableRefObject, useCallback, useEffect, useRef, useState } from 'react';
import BpmnModeler from 'bpmn-js/lib/Modeler';
import {
  BrandIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  FitIcon,
  PlusIcon,
  RedoIcon,
  SwapIcon,
  UndoIcon,
  UploadIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from '@/components/Icons';

interface BpmnCanvas {
  zoom: (level?: number | 'fit-viewport', center?: 'auto') => number;
  addMarker: (elementId: string, marker: string) => void;
  removeMarker: (elementId: string, marker: string) => void;
  scrollToElement?: (element: unknown) => void;
  getRootElement?: () => BpmnShape | undefined;
  viewbox: (box?: { x: number; y: number; width: number; height: number }) => {
    x: number;
    y: number;
    width: number;
    height: number;
    scale?: number;
  };
}

interface BpmnElementRegistry {
  get: (id: string) => BpmnShape | undefined;
}

interface BpmnShape {
  id: string;
  type?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  parent?: BpmnShape;
  host?: BpmnShape;
  attachers?: BpmnShape[];
  outgoing?: unknown[];
}

interface BpmnModeling {
  moveElements: (
    shapes: BpmnShape[],
    delta: { x: number; y: number },
    target?: BpmnShape,
    hints?: { attach?: boolean }
  ) => void;
  layoutConnection: (connection: unknown, hints?: Record<string, unknown>) => void;
}

interface BpmnSelection {
  get: () => BpmnShape[];
  select: (elements: BpmnShape | BpmnShape[], add?: boolean) => void;
  deselect: (element: BpmnShape) => void;
  isSelected: (element: BpmnShape) => boolean;
}

interface BpmnCommandStack {
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

type BpmnBusCallback = (e?: {
  element?: BpmnShape;
  originalEvent?: MouseEvent;
  newSelection?: BpmnShape[];
  context?: { shape?: BpmnShape; shapes?: BpmnShape[] };
}) => unknown;

interface BpmnEventBus {
  on: (
    event: string,
    priorityOrCallback: number | BpmnBusCallback,
    callback?: BpmnBusCallback
  ) => void;
  off: (event: string, callback: BpmnBusCallback) => void;
}

interface BoundaryAnchorPos {
  left: number;
  top: number;
  placement: 'above' | 'below';
}

interface BoundaryReorderContext {
  hostId: string;
  selectedBoundaryId: string | null;
  count: number;
  index: number;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  anchorPos: BoundaryAnchorPos | null;
}

interface BpmnEditorProps {
  xml: string | null;
  loadRevision?: number;
  blankTrigger: number;
  loading: boolean;
  elapsedSec: number;
  highlightedElementIds: string[];
  assumptionElementIds: string[];
  onElementSelectAssumption: (elementId: string) => void;
  onImportBpmn: (xml: string, filename: string) => void;
  onImportResult?: (ok: boolean) => void;
  xmlGetterRef: MutableRefObject<(() => Promise<string | null>) | null>;
  onCreateBlank: () => void;
  onFocusDescription?: () => void;
  onCancelGeneration?: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onDiagramChange?: () => void;
  onNotify: (message: string) => void;
}

const CLIENT_FORBIDDEN_IMPORT_PATTERNS = [
  /<!DOCTYPE/i,
  /<!ENTITY/i,
  /<script\b/i,
  /javascript:/i,
];

function computeAnchorPos(
  host: BpmnShape,
  canvas: BpmnCanvas | null,
  container: HTMLDivElement | null
): BoundaryAnchorPos | null {
  if (
    !canvas ||
    typeof host.x !== 'number' ||
    typeof host.y !== 'number' ||
    typeof host.width !== 'number' ||
    typeof host.height !== 'number'
  ) {
    return null;
  }
  const vb = canvas.viewbox();
  const stageW = container?.clientWidth || 800;
  const stageH = container?.clientHeight || 600;
  const scale =
    typeof vb.scale === 'number' && vb.scale > 0
      ? vb.scale
      : vb.width > 0
        ? stageW / vb.width
        : 1;

  const hostCenterX = (host.x + host.width / 2 - vb.x) * scale;
  const topAbove = (host.y - vb.y) * scale - 12;
  const placement: 'above' | 'below' = topAbove < 56 ? 'below' : 'above';
  const rawTop =
    placement === 'below' ? (host.y + host.height + 48 - vb.y) * scale : topAbove;

  const halfW = Math.min(175, Math.max(110, stageW / 2 - 12));
  const left = Math.max(halfW, Math.min(Math.max(halfW, stageW - halfW), hostCenterX));
  const top =
    placement === 'above'
      ? Math.max(54, Math.min(Math.max(54, stageH - 16), rawTop))
      : Math.max(12, Math.min(Math.max(12, stageH - 54), rawTop));

  return { left, top, placement };
}

function triggerDownload(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function getLoadingPhase(elapsedSec: number): { label: string; pct: number } {
  if (elapsedSec < 4) {
    return { label: 'Analizando actores, actividades y decisiones...', pct: 28 };
  }
  if (elapsedSec < 11) {
    return { label: 'Construyendo estructura BPMN 2.0 semántica...', pct: 62 };
  }
  return { label: 'Validando sintaxis y calculando layout automático...', pct: 88 };
}

export default function BpmnEditor({
  xml,
  loadRevision = 0,
  blankTrigger,
  loading,
  elapsedSec,
  highlightedElementIds,
  assumptionElementIds,
  onElementSelectAssumption,
  onImportBpmn,
  onImportResult,
  xmlGetterRef,
  onCreateBlank,
  onFocusDescription,
  onCancelGeneration,
  onDirtyChange,
  onDiagramChange,
  onNotify,
}: BpmnEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const modelerRef = useRef<BpmnModeler | null>(null);
  const prevHighlightedRef = useRef<string[]>([]);
  const prevAssumptionMarkedRef = useRef<string[]>([]);
  const isReorderingRef = useRef(false);
  const onSelectRef = useRef(onElementSelectAssumption);
  onSelectRef.current = onElementSelectAssumption;
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;
  const onDiagramChangeRef = useRef(onDiagramChange);
  onDiagramChangeRef.current = onDiagramChange;
  const onImportResultRef = useRef(onImportResult);
  onImportResultRef.current = onImportResult;
  const [importError, setImportError] = useState<string | null>(null);
  const [hasDiagram, setHasDiagram] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [zoomPct, setZoomPct] = useState(100);
  const [xmlOpen, setXmlOpen] = useState(false);
  const [currentXml, setCurrentXml] = useState('');
  const [boundaryContext, setBoundaryContext] = useState<BoundaryReorderContext | null>(null);
  const [multiSelectCount, setMultiSelectCount] = useState(0);

  const computeBoundaryContext = useCallback(
    (selectedShapes: BpmnShape[]): BoundaryReorderContext | null => {
      const primary = selectedShapes[0];
      if (!primary) return null;
      const canvas = modelerRef.current
        ? (modelerRef.current.get('canvas') as BpmnCanvas)
        : null;

      if (primary.type === 'bpmn:BoundaryEvent' && primary.host?.id) {
        const attachers = (primary.host.attachers || [])
          .filter((a) => a.type === 'bpmn:BoundaryEvent' && typeof a.x === 'number')
          .sort((a, b) => (a.x ?? 0) - (b.x ?? 0));
        if (attachers.length < 2) return null;
        const index = attachers.findIndex((a) => a.id === primary.id);
        if (index === -1) return null;
        return {
          hostId: primary.host.id,
          selectedBoundaryId: primary.id,
          count: attachers.length,
          index,
          canMoveLeft: index > 0,
          canMoveRight: index < attachers.length - 1,
          anchorPos: computeAnchorPos(primary.host, canvas, containerRef.current),
        };
      }

      const hostAttachers = (primary.attachers || []).filter(
        (a) => a.type === 'bpmn:BoundaryEvent' && typeof a.x === 'number'
      );
      if (hostAttachers.length >= 2) {
        return {
          hostId: primary.id,
          selectedBoundaryId: null,
          count: hostAttachers.length,
          index: 0,
          canMoveLeft: false,
          canMoveRight: false,
          anchorPos: computeAnchorPos(primary, canvas, containerRef.current),
        };
      }

      return null;
    },
    []
  );

  const syncZoom = useCallback(() => {
    const modeler = modelerRef.current;
    if (!modeler) return;
    const canvas = modeler.get('canvas') as BpmnCanvas;
    const level = canvas.zoom();
    if (typeof level === 'number' && Number.isFinite(level)) {
      setZoomPct(Math.round(level * 100));
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const modeler = new BpmnModeler({
      container: containerRef.current,
      keyboard: { bindTo: containerRef.current },
    });
    modelerRef.current = modeler;

    const eventBus = modeler.get('eventBus') as BpmnEventBus;
    const commandStack = modeler.get('commandStack') as BpmnCommandStack;
    const selection = modeler.get('selection') as BpmnSelection;
    const modeling = modeler.get('modeling') as BpmnModeling;
    const registry = modeler.get('elementRegistry') as BpmnElementRegistry;
    const canvas = modeler.get('canvas') as BpmnCanvas;

    const countMultiSelected = (shapes: BpmnShape[]): number =>
      shapes.filter(
        (s) =>
          s.type !== 'bpmn:Participant' &&
          s.type !== 'bpmn:Lane' &&
          s.type !== 'bpmn:Process' &&
          s.type !== 'bpmn:Collaboration' &&
          s.type !== 'label'
      ).length;

    const refreshBoundarySelection = () => {
      const current = selection.get() || [];
      setBoundaryContext(computeBoundaryContext(current));
      setMultiSelectCount(countMultiSelected(current));
    };

    const onStackChanged: BpmnBusCallback = () => {
      const undoable = commandStack.canUndo();
      setCanUndo(undoable);
      setCanRedo(commandStack.canRedo());
      onDirtyChangeRef.current(undoable);
      onDiagramChangeRef.current?.();
      refreshBoundarySelection();
    };

    const onSelectionChanged: BpmnBusCallback = (event) => {
      const current = event?.newSelection || [];
      setBoundaryContext(computeBoundaryContext(current));
      setMultiSelectCount(countMultiSelected(current));
    };

    const isCtrlMultiTarget = (
      event?: Parameters<BpmnBusCallback>[0]
    ): event is { element: BpmnShape; originalEvent: MouseEvent } => {
      const orig = event?.originalEvent;
      const el = event?.element;
      if (!orig || !el || orig.button !== 0 || orig.shiftKey || !(orig.ctrlKey || orig.metaKey)) {
        return false;
      }
      const rootEl = canvas.getRootElement?.();
      if (rootEl && el === rootEl) return false;
      return (
        el.type !== 'bpmn:Participant' &&
        el.type !== 'bpmn:Lane' &&
        el.type !== 'bpmn:Process' &&
        el.type !== 'bpmn:Collaboration'
      );
    };

    const onCtrlMultiMouseDown: BpmnBusCallback = (event) => {
      if (!isCtrlMultiTarget(event)) return undefined;
      if (selection.isSelected(event.element)) {
        selection.deselect(event.element);
      } else {
        selection.select(event.element, true);
      }
      return false;
    };

    const onCtrlMultiClick: BpmnBusCallback = (event) => {
      if (isCtrlMultiTarget(event)) {
        return false;
      }
      return undefined;
    };

    const onBoundaryMoved: BpmnBusCallback = (event) => {
      if (isReorderingRef.current) return;
      const moved = event?.context?.shape
        ? [event.context.shape]
        : event?.context?.shapes || [];
      const hostsToRelayout = new Set<string>();
      for (const s of moved) {
        if (s.type === 'bpmn:BoundaryEvent' && s.host?.id) {
          hostsToRelayout.add(s.host.id);
        }
      }
      if (hostsToRelayout.size === 0) return;

      isReorderingRef.current = true;
      try {
        for (const hostId of hostsToRelayout) {
          const host = registry.get(hostId);
          for (const att of host?.attachers || []) {
            if (att.type !== 'bpmn:BoundaryEvent') continue;
            for (const conn of att.outgoing || []) {
              modeling.layoutConnection(conn);
            }
          }
        }
      } catch {
        // Ignora errores transitorios al recalcular flujos tras arrastre manual.
      } finally {
        isReorderingRef.current = false;
      }
    };

    const onViewboxChanged: BpmnBusCallback = () => {
      syncZoom();
      refreshBoundarySelection();
    };
    const onElementClick: BpmnBusCallback = (event) => {
      const id = event?.element?.id;
      if (id) onSelectRef.current(id);
    };

    eventBus.on('commandStack.changed', onStackChanged);
    eventBus.on('selection.changed', onSelectionChanged);
    eventBus.on('element.mousedown', 2000, onCtrlMultiMouseDown);
    eventBus.on('element.click', 2000, onCtrlMultiClick);
    eventBus.on('commandStack.shape.move.postExecuted', onBoundaryMoved);
    eventBus.on('commandStack.elements.move.postExecuted', onBoundaryMoved);
    eventBus.on('canvas.viewbox.changed', onViewboxChanged);
    eventBus.on('element.click', onElementClick);

    xmlGetterRef.current = async () => {
      try {
        const { xml: liveXml } = await modeler.saveXML({ format: false });
        return liveXml || null;
      } catch {
        return null;
      }
    };

    return () => {
      xmlGetterRef.current = null;
      eventBus.off('commandStack.changed', onStackChanged);
      eventBus.off('selection.changed', onSelectionChanged);
      eventBus.off('element.mousedown', onCtrlMultiMouseDown);
      eventBus.off('element.click', onCtrlMultiClick);
      eventBus.off('commandStack.shape.move.postExecuted', onBoundaryMoved);
      eventBus.off('commandStack.elements.move.postExecuted', onBoundaryMoved);
      eventBus.off('canvas.viewbox.changed', onViewboxChanged);
      eventBus.off('element.click', onElementClick);
      modeler.destroy();
      modelerRef.current = null;
    };
  }, [computeBoundaryContext, syncZoom, xmlGetterRef]);

  useEffect(() => {
    const modeler = modelerRef.current;
    if (!modeler || !xml) return;

    let cancelled = false;
    setImportError(null);
    setBoundaryContext(null);

    modeler
      .importXML(xml)
      .then(() => {
        if (cancelled) return;
        const canvas = modeler.get('canvas') as BpmnCanvas;
        canvas.zoom('fit-viewport', 'auto');
        syncZoom();
        setHasDiagram(true);
        setCanUndo(false);
        setCanRedo(false);
        onDirtyChangeRef.current(false);
        onImportResultRef.current?.(true);
      })
      .catch(() => {
        if (cancelled) return;
        setHasDiagram(false);
        setBoundaryContext(null);
        setImportError(
          'No se pudo renderizar el diagrama BPMN en el editor. Intentá regenerar o verificá el archivo importado.'
        );
        onImportResultRef.current?.(false);
      });

    return () => {
      cancelled = true;
    };
  }, [xml, loadRevision, syncZoom]);

  useEffect(() => {
    if (blankTrigger === 0) return;
    const modeler = modelerRef.current;
    if (!modeler) return;

    let cancelled = false;
    setImportError(null);
    setBoundaryContext(null);

    modeler
      .createDiagram()
      .then(() => {
        if (cancelled) return;
        const canvas = modeler.get('canvas') as BpmnCanvas;
        canvas.zoom('fit-viewport', 'auto');
        syncZoom();
        setHasDiagram(true);
        setCanUndo(false);
        setCanRedo(false);
        onDirtyChangeRef.current(false);
      })
      .catch(() => {
        if (cancelled) return;
        setImportError('No se pudo inicializar el diagrama en blanco.');
      });

    return () => {
      cancelled = true;
    };
  }, [blankTrigger, syncZoom]);

  useEffect(() => {
    const modeler = modelerRef.current;
    if (!modeler || !hasDiagram) return;

    const canvas = modeler.get('canvas') as BpmnCanvas;
    const registry = modeler.get('elementRegistry') as BpmnElementRegistry;

    for (const oldId of prevAssumptionMarkedRef.current) {
      if (registry.get(oldId)) {
        canvas.removeMarker(oldId, 'bpmn-has-assumption');
      }
    }
    const validAll = assumptionElementIds.filter((id) => Boolean(registry.get(id)));
    for (const id of validAll) {
      canvas.addMarker(id, 'bpmn-has-assumption');
    }
    prevAssumptionMarkedRef.current = validAll;
  }, [assumptionElementIds, hasDiagram]);

  useEffect(() => {
    const modeler = modelerRef.current;
    if (!modeler || !hasDiagram) return;

    const canvas = modeler.get('canvas') as BpmnCanvas;
    const registry = modeler.get('elementRegistry') as BpmnElementRegistry;

    for (const oldId of prevHighlightedRef.current) {
      if (registry.get(oldId)) {
        canvas.removeMarker(oldId, 'bpmn-assumption-highlight');
      }
    }

    const validIds = highlightedElementIds.filter((id) => Boolean(registry.get(id)));
    for (const id of validIds) {
      canvas.addMarker(id, 'bpmn-assumption-highlight');
    }
    prevHighlightedRef.current = validIds;

    let rafId = 0;
    if (validIds.length > 0) {
      const firstEl = registry.get(validIds[0]);
      if (firstEl && typeof firstEl.x === 'number' && typeof firstEl.y === 'number') {
        const startVb = canvas.viewbox();
        const targetX = firstEl.x - startVb.width / 2 + (firstEl.width || 80) / 2;
        const targetY = firstEl.y - startVb.height / 2 + (firstEl.height || 60) / 2;
        const durationMs = 380;
        const startTime = performance.now();

        const animate = (now: number) => {
          const t = Math.min(1, (now - startTime) / durationMs);
          const eased = 1 - Math.pow(1 - t, 3);
          canvas.viewbox({
            x: startVb.x + (targetX - startVb.x) * eased,
            y: startVb.y + (targetY - startVb.y) * eased,
            width: startVb.width,
            height: startVb.height,
          });
          if (t < 1) {
            rafId = requestAnimationFrame(animate);
          }
        };
        rafId = requestAnimationFrame(animate);
      }
    }

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [highlightedElementIds, hasDiagram]);

  const handleZoom = (delta: number) => {
    const modeler = modelerRef.current;
    if (!modeler || !hasDiagram) return;
    const canvas = modeler.get('canvas') as BpmnCanvas;
    const current = canvas.zoom();
    canvas.zoom(Math.max(0.2, Math.min(4, current + delta)));
    syncZoom();
  };

  const handleFit = () => {
    const modeler = modelerRef.current;
    if (!modeler || !hasDiagram) return;
    const canvas = modeler.get('canvas') as BpmnCanvas;
    canvas.zoom('fit-viewport');
    syncZoom();
  };

  const handleUndo = () => {
    const modeler = modelerRef.current;
    if (!modeler || !canUndo) return;
    const commandStack = modeler.get('commandStack') as BpmnCommandStack;
    commandStack.undo();
  };

  const handleRedo = () => {
    const modeler = modelerRef.current;
    if (!modeler || !canRedo) return;
    const commandStack = modeler.get('commandStack') as BpmnCommandStack;
    commandStack.redo();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 500 * 1024) {
      setImportError('El archivo .bpmn supera el límite de 500 KB.');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => {
      setImportError('No se pudo leer el archivo seleccionado.');
    };
    reader.onload = () => {
      const content = typeof reader.result === 'string' ? reader.result : '';
      if (!content.trim()) {
        setImportError('El archivo seleccionado está vacío.');
        return;
      }
      if (CLIENT_FORBIDDEN_IMPORT_PATTERNS.some((pattern) => pattern.test(content))) {
        setImportError('El archivo .bpmn contiene directivas o scripts no permitidos.');
        return;
      }
      if (!/<(?:[a-zA-Z0-9_-]+:)?definitions\b/i.test(content)) {
        setImportError('El archivo seleccionado no es un documento BPMN 2.0 válido (<definitions>).');
        return;
      }
      onImportBpmn(content, file.name);
    };
    reader.readAsText(file, 'utf-8');
  };

  const handleDownloadBpmn = async () => {
    const modeler = modelerRef.current;
    if (!modeler || !hasDiagram) return;
    try {
      const { xml: exportedXml } = await modeler.saveXML({ format: true });
      if (exportedXml) {
        triggerDownload(exportedXml, 'proceso.bpmn', 'application/xml;charset=utf-8');
        onNotify('Archivo proceso.bpmn descargado.');
      }
    } catch {
      setImportError('No se pudo exportar el archivo .bpmn.');
    }
  };

  const handleToggleXml = async () => {
    const modeler = modelerRef.current;
    if (!modeler || !hasDiagram) return;
    if (!xmlOpen) {
      try {
        const { xml: latestXml } = await modeler.saveXML({ format: true });
        setCurrentXml(latestXml || '');
      } catch {
        setCurrentXml('No se pudo leer el XML actual del diagrama.');
      }
    }
    setXmlOpen((open) => !open);
  };

  const handleReorderBoundary = (direction: 'left' | 'right' | 'swap') => {
    const modeler = modelerRef.current;
    if (!modeler || !hasDiagram || !boundaryContext) return;

    const registry = modeler.get('elementRegistry') as BpmnElementRegistry;
    const modeling = modeler.get('modeling') as BpmnModeling;
    const selection = modeler.get('selection') as BpmnSelection;

    const host = registry.get(boundaryContext.hostId);
    if (!host || typeof host.x !== 'number' || typeof host.y !== 'number' || typeof host.width !== 'number' || typeof host.height !== 'number') {
      return;
    }

    const attachers = (host.attachers || [])
      .filter(
        (a) =>
          a.type === 'bpmn:BoundaryEvent' &&
          typeof a.x === 'number' &&
          typeof a.y === 'number' &&
          typeof a.width === 'number' &&
          typeof a.height === 'number'
      )
      .sort((a, b) => (a.x ?? 0) - (b.x ?? 0));

    if (attachers.length < 2) return;

    const reordered = [...attachers];
    if (boundaryContext.selectedBoundaryId) {
      const idx = attachers.findIndex((a) => a.id === boundaryContext.selectedBoundaryId);
      if (idx === -1) return;
      if (direction === 'left' && idx > 0) {
        [reordered[idx - 1], reordered[idx]] = [reordered[idx], reordered[idx - 1]];
      } else if (direction === 'right' && idx < reordered.length - 1) {
        [reordered[idx], reordered[idx + 1]] = [reordered[idx + 1], reordered[idx]];
      } else if (direction === 'swap' && reordered.length === 2) {
        [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
      } else {
        return;
      }
    } else if (attachers.length === 2) {
      [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
    } else {
      const first = reordered.shift();
      if (first) reordered.push(first);
    }

    const currentSlots = attachers.map((a) => ({ x: a.x as number, y: a.y as number }));
    const minSlotGap = currentSlots.slice(1).reduce((min, slot, i) => {
      return Math.min(min, Math.abs(slot.x - currentSlots[i].x));
    }, Infinity);

    const targetSlots =
      minSlotGap >= 40
        ? currentSlots
        : attachers.map((att, idx) => {
            const w = att.width as number;
            const h = att.height as number;
            const cx =
              (host.x as number) +
              20 +
              (idx * Math.max(44, (host.width as number) - 40)) / (attachers.length - 1);
            return {
              x: Math.round(cx - w / 2),
              y: Math.round((host.y as number) + (host.height as number) - h / 2),
            };
          });

    isReorderingRef.current = true;
    try {
      reordered.forEach((att, idx) => {
        const liveAtt = registry.get(att.id);
        const liveHost = registry.get(host.id);
        if (!liveAtt || !liveHost || typeof liveAtt.x !== 'number' || typeof liveAtt.y !== 'number') {
          return;
        }
        const dx = Math.round(targetSlots[idx].x - liveAtt.x);
        const dy = Math.round(targetSlots[idx].y - liveAtt.y);
        if (dx !== 0 || dy !== 0) {
          modeling.moveElements([liveAtt], { x: dx, y: dy }, liveHost, { attach: true });
        }
      });

      const refreshedHost = registry.get(host.id);
      for (const att of refreshedHost?.attachers || []) {
        if (att.type !== 'bpmn:BoundaryEvent') continue;
        for (const conn of att.outgoing || []) {
          modeling.layoutConnection(conn);
        }
      }

      setBoundaryContext(computeBoundaryContext(selection.get() || []));
      onNotify('Orden de eventos adjuntos actualizado y flujos adaptados.');
    } catch {
      onNotify('No se pudo reordenar los eventos adjuntos automáticamente.');
    } finally {
      isReorderingRef.current = false;
    }
  };

  const handleCopyXml = async () => {
    if (!currentXml) return;
    try {
      await navigator.clipboard.writeText(currentXml);
      onNotify('XML BPMN copiado al portapapeles.');
    } catch {
      onNotify('No se pudo copiar al portapapeles.');
    }
  };

  const handleDownloadSvg = async () => {
    const modeler = modelerRef.current;
    if (!modeler || !hasDiagram) return;
    try {
      const { svg } = await modeler.saveSVG();
      if (svg) {
        triggerDownload(svg, 'proceso.svg', 'image/svg+xml;charset=utf-8');
        onNotify('Archivo proceso.svg descargado.');
      }
    } catch {
      setImportError('No se pudo exportar el archivo .svg.');
    }
  };

  const phase = getLoadingPhase(elapsedSec);

  return (
    <section className="canvas-panel" aria-label="Editor BPMN 2.0">
      <div className="editor-toolbar">
        <div className="toolbar-group">
          <button type="button" className="tool-btn" onClick={() => handleZoom(-0.2)} disabled={!hasDiagram} title="Alejar" aria-label="Alejar">
            <ZoomOutIcon />
          </button>
          <button type="button" className="zoom-label mono" onClick={handleFit} disabled={!hasDiagram} title="Ajustar al lienzo">
            {hasDiagram ? `${zoomPct}%` : '—'}
          </button>
          <button type="button" className="tool-btn" onClick={() => handleZoom(0.2)} disabled={!hasDiagram} title="Acercar" aria-label="Acercar">
            <ZoomInIcon />
          </button>
          <button type="button" className="tool-btn" onClick={handleFit} disabled={!hasDiagram} title="Centrar diagrama">
            <FitIcon />
            <span className="tool-label-desktop">Centrar</span>
          </button>
          <span className="toolbar-divider" />
          <button type="button" className="tool-btn" onClick={handleUndo} disabled={!canUndo} title="Deshacer (Ctrl+Z)">
            <UndoIcon />
            <span className="tool-label-desktop">Deshacer</span>
          </button>
          <button type="button" className="tool-btn" onClick={handleRedo} disabled={!canRedo} title="Rehacer (Ctrl+Y)">
            <RedoIcon />
            <span className="tool-label-desktop">Rehacer</span>
          </button>
        </div>

        <div className="toolbar-group" data-tour="export-toolbar">
          <input
            ref={fileInputRef}
            type="file"
            accept=".bpmn,.xml"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <button
            type="button"
            className="tool-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            title="Importar archivo BPMN 2.0 local"
          >
            <UploadIcon />
            <span className="tool-label-desktop">Importar</span>
          </button>
          <button
            type="button"
            className={`tool-btn ${xmlOpen ? 'active' : ''}`}
            onClick={() => void handleToggleXml()}
            disabled={!hasDiagram}
            aria-expanded={xmlOpen}
            title="Inspeccionar XML BPMN 2.0"
          >
            <CodeIcon />
            <span>{xmlOpen ? 'Ocultar XML' : 'XML'}</span>
          </button>
          <button type="button" className="tool-btn" onClick={handleDownloadBpmn} disabled={!hasDiagram} title="Descargar archivo .bpmn estándar">
            <DownloadIcon />
            <span>.bpmn</span>
          </button>
          <button type="button" className="tool-btn" onClick={handleDownloadSvg} disabled={!hasDiagram} title="Descargar diagrama vectorial .svg">
            <DownloadIcon />
            <span>.svg</span>
          </button>
        </div>
      </div>

      <div className={`editor-stage ${!hasDiagram ? 'is-empty' : ''}`} data-tour="bpmn-canvas">
        <div ref={containerRef} className="bpmn-container" tabIndex={0} />

        {!hasDiagram && !importError && !loading && (
          <div className="empty-state">
            <div className="empty-card">
              <div className="empty-icon">
                <BrandIcon />
              </div>
              <h2>Tu diagrama BPMN 2.0 aparecerá aquí</h2>
              <p>
                Describí un proceso en el panel izquierdo, elegí un ejemplo precargado o iniciá un
                lienzo en blanco para modelar manualmente con la paleta BPMN.
              </p>
              <div className="empty-actions">
                {onFocusDescription && (
                  <button type="button" className="tool-btn" onClick={onFocusDescription}>
                    <span>Escribir descripción</span>
                  </button>
                )}
                <button type="button" className="tool-btn" onClick={onCreateBlank}>
                  <PlusIcon />
                  <span>Crear en blanco</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {importError && !loading && (
          <div className="empty-state">
            <div className="empty-card" role="alert">
              <h2>Error al cargar el diagrama</h2>
              <p>{importError}</p>
              <div className="empty-actions">
                <button type="button" className="tool-btn" onClick={() => setImportError(null)}>
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        )}

        {loading && (
          <div className="loading-overlay" role="status" aria-live="polite">
            <div className="loading-card">
              <div className="loading-header">
                <span>Generando diagrama BPMN 2.0</span>
                <span className="mono">{elapsedSec}s</span>
              </div>
              <div className="progress-track">
                <div className="progress-bar" style={{ width: `${phase.pct}%` }} />
              </div>
              <p className="loading-phase">{phase.label}</p>
              {onCancelGeneration && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                  <button type="button" className="tool-btn" onClick={onCancelGeneration}>
                    Cancelar
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {hasDiagram && !loading && !importError && boundaryContext && (
          <div
            className={`boundary-reorder-bar ${
              boundaryContext.anchorPos
                ? `is-anchored ${boundaryContext.anchorPos.placement}`
                : ''
            }`}
            style={
              boundaryContext.anchorPos
                ? {
                    left: `${Math.round(boundaryContext.anchorPos.left)}px`,
                    top: `${Math.round(boundaryContext.anchorPos.top)}px`,
                  }
                : undefined
            }
            role="region"
            aria-label="Reordenar eventos adjuntos"
          >
            <span className="boundary-reorder-label">
              {boundaryContext.selectedBoundaryId
                ? `Evento adjunto (${boundaryContext.index + 1}/${boundaryContext.count})`
                : `${boundaryContext.count} eventos adjuntos`}
            </span>
            <div className="boundary-reorder-actions">
              {boundaryContext.selectedBoundaryId ? (
                <>
                  <button
                    type="button"
                    className="tool-btn"
                    disabled={!boundaryContext.canMoveLeft}
                    onClick={() => handleReorderBoundary('left')}
                    title="Mover evento una posición a la izquierda y adaptar flujos"
                  >
                    <ChevronLeftIcon />
                    <span>Mover izq.</span>
                  </button>
                  <button
                    type="button"
                    className="tool-btn"
                    disabled={!boundaryContext.canMoveRight}
                    onClick={() => handleReorderBoundary('right')}
                    title="Mover evento una posición a la derecha y adaptar flujos"
                  >
                    <span>Mover der.</span>
                    <ChevronRightIcon />
                  </button>
                  {boundaryContext.count === 2 && (
                    <button
                      type="button"
                      className="tool-btn"
                      onClick={() => handleReorderBoundary('swap')}
                      title="Intercambiar orden con el evento adjunto par y adaptar flujos"
                    >
                      <SwapIcon />
                      <span>Intercambiar</span>
                    </button>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  className="tool-btn"
                  onClick={() => handleReorderBoundary('swap')}
                  title="Reordenar eventos adjuntos de esta tarea y adaptar sus flujos"
                >
                  <SwapIcon />
                  <span>{boundaryContext.count === 2 ? 'Intercambiar orden' : 'Rotar orden'}</span>
                </button>
              )}
            </div>
          </div>
        )}

        {hasDiagram && !loading && !importError && !boundaryContext && multiSelectCount >= 2 && (
          <div className="multi-select-pill" role="status" aria-live="polite">
            {multiSelectCount} elementos seleccionados · Arrastrá para mover en conjunto
          </div>
        )}
      </div>
      {xmlOpen && hasDiagram && (
        <div className="xml-drawer" role="region" aria-label="Inspector de XML BPMN 2.0">
          <div className="xml-drawer-header">
            <span className="mono">BPMN 2.0 XML (actual)</span>
            <div className="toolbar-group">
              <button type="button" className="tool-btn" onClick={() => void handleCopyXml()}>
                <CopyIcon />
                <span>Copiar XML</span>
              </button>
              <button type="button" className="tool-btn" onClick={() => setXmlOpen(false)}>
                Cerrar
              </button>
            </div>
          </div>
          <pre className="xml-code mono">{currentXml}</pre>
        </div>
      )}
    </section>
  );
}
