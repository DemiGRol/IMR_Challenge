'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import BpmnModeler from 'bpmn-js/lib/Modeler';
import {
  DownloadIcon,
  FitIcon,
  PlusIcon,
  RedoIcon,
  UndoIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from '@/components/Icons';

interface BpmnCanvas {
  zoom: (level?: number | 'fit-viewport', center?: 'auto') => number;
}

interface BpmnCommandStack {
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

interface BpmnEventBus {
  on: (event: string, callback: () => void) => void;
  off: (event: string, callback: () => void) => void;
}

interface BpmnEditorProps {
  xml: string | null;
  blankTrigger: number;
  loading: boolean;
  elapsedSec: number;
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
  onCreateBlank,
  onDirtyChange,
  onNotify,
}: BpmnEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const modelerRef = useRef<BpmnModeler | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [hasDiagram, setHasDiagram] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [zoomPct, setZoomPct] = useState(100);

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

    eventBus.on('commandStack.changed', onStackChanged);
    eventBus.on('canvas.viewbox.changed', onViewboxChanged);

    return () => {
      eventBus.off('commandStack.changed', onStackChanged);
      eventBus.off('canvas.viewbox.changed', onViewboxChanged);
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
    </section>
  );
}
