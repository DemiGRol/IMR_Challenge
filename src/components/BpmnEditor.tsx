'use client';

import { useEffect, useRef, useState } from 'react';
import BpmnModeler from 'bpmn-js/lib/Modeler';

interface BpmnCanvas {
  zoom: (level?: number | 'fit-viewport') => number;
}

interface BpmnCommandStack {
  undo: () => void;
  redo: () => void;
}

interface BpmnEditorProps {
  xml: string | null;
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
  URL.revokeObjectURL(url);
}

export default function BpmnEditor({ xml }: BpmnEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const modelerRef = useRef<BpmnModeler | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [hasDiagram, setHasDiagram] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const modeler = new BpmnModeler({
      container: containerRef.current,
    });
    modelerRef.current = modeler;

    return () => {
      modeler.destroy();
      modelerRef.current = null;
    };
  }, []);

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
        canvas.zoom('fit-viewport');
        setHasDiagram(true);
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
  }, [xml]);

  const handleZoom = (delta: number) => {
    const modeler = modelerRef.current;
    if (!modeler || !hasDiagram) return;
    const canvas = modeler.get('canvas') as BpmnCanvas;
    const current = canvas.zoom();
    canvas.zoom(Math.max(0.2, Math.min(4, current + delta)));
  };

  const handleFit = () => {
    const modeler = modelerRef.current;
    if (!modeler || !hasDiagram) return;
    const canvas = modeler.get('canvas') as BpmnCanvas;
    canvas.zoom('fit-viewport');
  };

  const handleUndo = () => {
    const modeler = modelerRef.current;
    if (!modeler || !hasDiagram) return;
    const commandStack = modeler.get('commandStack') as BpmnCommandStack;
    commandStack.undo();
  };

  const handleRedo = () => {
    const modeler = modelerRef.current;
    if (!modeler || !hasDiagram) return;
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
      }
    } catch {
      setImportError('No se pudo exportar el archivo .svg.');
    }
  };

  return (
    <section className="canvas-panel" aria-label="Editor BPMN 2.0">
      <div className="editor-toolbar">
        <div className="toolbar-group">
          <button type="button" className="tool-btn" onClick={() => handleZoom(0.2)} disabled={!hasDiagram}>
            Zoom +
          </button>
          <button type="button" className="tool-btn" onClick={() => handleZoom(-0.2)} disabled={!hasDiagram}>
            Zoom −
          </button>
          <button type="button" className="tool-btn" onClick={handleFit} disabled={!hasDiagram}>
            Centrar
          </button>
          <button type="button" className="tool-btn" onClick={handleUndo} disabled={!hasDiagram}>
            Deshacer
          </button>
          <button type="button" className="tool-btn" onClick={handleRedo} disabled={!hasDiagram}>
            Rehacer
          </button>
        </div>
        <div className="toolbar-group">
          <button type="button" className="tool-btn" onClick={handleDownloadBpmn} disabled={!hasDiagram}>
            Descargar .bpmn
          </button>
          <button type="button" className="tool-btn" onClick={handleDownloadSvg} disabled={!hasDiagram}>
            Descargar .svg
          </button>
        </div>
      </div>

      <div className="editor-stage">
        <div ref={containerRef} className="bpmn-container" />
        {!hasDiagram && !importError && (
          <div className="empty-state">
            <h2>Tu diagrama BPMN 2.0 aparecerá aquí</h2>
            <p>
              Escribí una descripción de proceso en el panel izquierdo o elegí uno de los ejemplos
              precargados para generar y editar el diagrama interactivamente.
            </p>
          </div>
        )}
        {importError && (
          <div className="empty-state">
            <h2>Error al cargar el diagrama</h2>
            <p>{importError}</p>
          </div>
        )}
      </div>
    </section>
  );
}
