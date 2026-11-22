'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import BpmnModeler from 'bpmn-js/lib/Modeler';
import {
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  FitIcon,
  PlusIcon,
  RedoIcon,
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
  viewbox: (box?: { x: number; y: number; width: number; height: number }) => {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

interface BpmnElementRegistry {
  get: (id: string) => { x?: number; y?: number; width?: number; height?: number } | undefined;
}

interface BpmnCommandStack {
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

interface BpmnEventBus {
  on: (event: string, callback: (e?: { element?: { id?: string } }) => void) => void;
  off: (event: string, callback: (e?: { element?: { id?: string } }) => void) => void;
}

interface BpmnEditorProps {
  xml: string | null;
  blankTrigger: number;
  loading: boolean;
  elapsedSec: number;
  highlightedElementIds: string[];
  assumptionElementIds: string[];
  onElementSelectAssumption: (elementId: string) => void;
  onImportBpmn: (xml: string, filename: string) => void;
  onCreateBlank: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onNotify: (message: string) => void;
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
  blankTrigger,
  loading,
  elapsedSec,
  highlightedElementIds,
  assumptionElementIds,
  onElementSelectAssumption,
  onImportBpmn,
  onCreateBlank,
  onDirtyChange,
  onNotify,
}: BpmnEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const modelerRef = useRef<BpmnModeler | null>(null);
  const prevHighlightedRef = useRef<string[]>([]);
  const prevAssumptionMarkedRef = useRef<string[]>([]);
  const onSelectRef = useRef(onElementSelectAssumption);
  onSelectRef.current = onElementSelectAssumption;
  const [importError, setImportError] = useState<string | null>(null);
  const [hasDiagram, setHasDiagram] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [zoomPct, setZoomPct] = useState(100);
  const [xmlOpen, setXmlOpen] = useState(false);
  const [currentXml, setCurrentXml] = useState('');

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

    const onStackChanged = () => {
      const undoable = commandStack.canUndo();
      setCanUndo(undoable);
      setCanRedo(commandStack.canRedo());
      if (undoable) {
        onDirtyChange(true);
      }
    };

    const onViewboxChanged = () => syncZoom();
    const onElementClick = (event?: { element?: { id?: string } }) => {
      const id = event?.element?.id;
      if (id) onSelectRef.current(id);
    };

    eventBus.on('commandStack.changed', onStackChanged);
    eventBus.on('canvas.viewbox.changed', onViewboxChanged);
    eventBus.on('element.click', onElementClick);

    return () => {
      eventBus.off('commandStack.changed', onStackChanged);
      eventBus.off('canvas.viewbox.changed', onViewboxChanged);
      eventBus.off('element.click', onElementClick);
      modeler.destroy();
      modelerRef.current = null;
    };
  }, [onDirtyChange, syncZoom]);

  useEffect(() => {
    const modeler = modelerRef.current;
    if (!modeler || !xml) return;

    let cancelled = false;
    setImportError(null);

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
        onDirtyChange(false);
      })
      .catch(() => {
        if (cancelled) return;
        setHasDiagram(false);
        setImportError(
          'No se pudo renderizar el diagrama BPMN en el editor. Intentá regenerar el proceso.'
        );
      });

    return () => {
      cancelled = true;
    };
  }, [xml, onDirtyChange, syncZoom]);

  useEffect(() => {
    if (blankTrigger === 0) return;
    const modeler = modelerRef.current;
    if (!modeler) return;

    let cancelled = false;
    setImportError(null);

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
        onDirtyChange(false);
      })
      .catch(() => {
        if (cancelled) return;
        setImportError('No se pudo inicializar el diagrama en blanco.');
      });

    return () => {
      cancelled = true;
    };
  }, [blankTrigger, onDirtyChange, syncZoom]);

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
          if (t < 1) requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
      }
    }
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
    reader.onload = () => {
      const content = typeof reader.result === 'string' ? reader.result : '';
      if (!content.trim()) {
        setImportError('El archivo seleccionado está vacío.');
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
          <button type="button" className="tool-btn" onClick={() => handleZoom(-0.2)} disabled={!hasDiagram} title="Alejar">
            <ZoomOutIcon />
          </button>
          <span className="zoom-label mono">{hasDiagram ? `${zoomPct}%` : '—'}</span>
          <button type="button" className="tool-btn" onClick={() => handleZoom(0.2)} disabled={!hasDiagram} title="Acercar">
            <ZoomInIcon />
          </button>
          <button type="button" className="tool-btn" onClick={handleFit} disabled={!hasDiagram} title="Centrar diagrama">
            <FitIcon />
            <span>Centrar</span>
          </button>
          <span className="toolbar-divider" />
          <button type="button" className="tool-btn" onClick={handleUndo} disabled={!canUndo} title="Deshacer">
            <UndoIcon />
            <span>Deshacer</span>
          </button>
          <button type="button" className="tool-btn" onClick={handleRedo} disabled={!canRedo} title="Rehacer">
            <RedoIcon />
            <span>Rehacer</span>
          </button>
        </div>

        <div className="toolbar-group">
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
            <span>Importar .bpmn</span>
          </button>
          <button
            type="button"
            className="tool-btn"
            onClick={() => void handleToggleXml()}
            disabled={!hasDiagram}
            aria-expanded={xmlOpen}
          >
            <CodeIcon />
            <span>{xmlOpen ? 'Ocultar XML' : 'Ver XML'}</span>
          </button>
          <button type="button" className="tool-btn" onClick={handleDownloadBpmn} disabled={!hasDiagram}>
            <DownloadIcon />
            <span>.bpmn</span>
          </button>
          <button type="button" className="tool-btn" onClick={handleDownloadSvg} disabled={!hasDiagram}>
            <DownloadIcon />
            <span>.svg</span>
          </button>
        </div>
      </div>

      <div className={`editor-stage ${!hasDiagram ? 'is-empty' : ''}`}>
        <div ref={containerRef} className="bpmn-container" tabIndex={0} />

        {!hasDiagram && !importError && !loading && (
          <div className="empty-state">
            <div className="empty-card">
              <h2>Tu diagrama BPMN 2.0 aparecerá aquí</h2>
              <p>
                Describí un proceso en el panel izquierdo, elegí un ejemplo precargado o iniciá un
                lienzo en blanco para modelar manualmente con la paleta BPMN.
              </p>
              <div className="empty-actions">
                <button type="button" className="tool-btn" onClick={onCreateBlank}>
                  <PlusIcon />
                  <span>Crear diagrama en blanco</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {importError && !loading && (
          <div className="empty-state">
            <div className="empty-card">
              <h2>Error al cargar el diagrama</h2>
              <p>{importError}</p>
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
            </div>
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
