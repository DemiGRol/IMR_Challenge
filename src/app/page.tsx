'use client';

import dynamic from 'next/dynamic';
import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { BrandIcon, PanelIcon, PlusIcon, SparklesIcon } from '@/components/Icons';
import { PROCESS_EXAMPLES } from '@/components/ProcessExamples';

const BpmnEditor = dynamic(() => import('@/components/BpmnEditor'), {
  ssr: false,
  loading: () => (
    <section className="canvas-panel">
      <div className="empty-state">
        <div className="empty-card">
          <p>Cargando editor BPMN...</p>
        </div>
      </div>
    </section>
  ),
});

interface GenerateMeta {
  provider: string;
  model: string;
  latencyMs: number;
  attempts?: number;
  repaired?: boolean;
}

interface StructuredAssumption {
  question: string;
  assumption: string;
}

interface GenerateResponse {
  bpmnXml?: string;
  assumptions?: StructuredAssumption[];
  meta?: GenerateMeta;
  error?: string;
}

type DiagramSource = 'empty' | 'ai' | 'blank';

export default function HomePage() {
  const [description, setDescription] = useState('');
  const [activeExampleId, setActiveExampleId] = useState<string | null>(null);
  const [bpmnXml, setBpmnXml] = useState<string | null>(null);
  const [blankTrigger, setBlankTrigger] = useState(0);
  const [diagramSource, setDiagramSource] = useState<DiagramSource>('empty');
  const [isDirty, setIsDirty] = useState(false);
  const [assumptions, setAssumptions] = useState<StructuredAssumption[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [assumptionsOpen, setAssumptionsOpen] = useState(true);
  const [meta, setMeta] = useState<GenerateMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const trimmedLength = description.trim().length;
  const isValidLength = trimmedLength >= 10 && trimmedLength <= 4000;

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 440)}px`;
  }, [description]);

  useEffect(() => {
    if (!loading) {
      setElapsedSec(0);
      return;
    }
    const id = setInterval(() => setElapsedSec((prev) => prev + 1), 1000);
    return () => clearInterval(id);
  }, [loading]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast((curr) => (curr === message ? null : curr)), 2600);
  }, []);

  const confirmOverwriteIfDirty = (): boolean => {
    if (!isDirty) return true;
    return window.confirm(
      'Tenés cambios manuales en el diagrama actual. ¿Querés reemplazarlo?'
    );
  };

  const handleCreateBlank = useCallback(() => {
    if (isDirty && !window.confirm('Tenés cambios manuales en el diagrama actual. ¿Querés iniciar uno en blanco?')) {
      return;
    }
    setBpmnXml(null);
    setAssumptions([]);
    setMeta(null);
    setError(null);
    setDiagramSource('blank');
    setBlankTrigger((prev) => prev + 1);
  }, [isDirty]);

  const generateDiagram = async () => {
    if (!isValidLength || loading) {
      if (!isValidLength) {
        setError('Ingresá una descripción de entre 10 y 4.000 caracteres.');
      }
      return;
    }
    if (!confirmOverwriteIfDirty()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/generate-bpmn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ processDescription: description.trim() }),
      });

      let data: GenerateResponse = {};
      try {
        data = (await res.json()) as GenerateResponse;
      } catch {
        setError(
          res.status === 504
            ? 'La generación excedió el tiempo máximo de espera del servidor. Intentá nuevamente.'
            : 'El servidor devolvió una respuesta inesperada. Intentá nuevamente.'
        );
        return;
      }
      if (!res.ok || !data.bpmnXml) {
        setError(data.error || 'No se pudo generar el diagrama BPMN. Intentá nuevamente.');
        return;
      }

      setBpmnXml(data.bpmnXml);
      setAssumptions(data.assumptions || []);
      setAssumptionsOpen(true);
      setMeta(data.meta || null);
      setDiagramSource('ai');
    } catch {
      setError('Error de conexión con el servidor. Verificá tu red e intentá nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void generateDiagram();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      void generateDiagram();
    }
  };

  const statusBadge = isDirty
    ? { label: 'Editado manualmente', className: 'badge badge-dirty' }
    : diagramSource === 'ai'
      ? { label: 'Generado por IA', className: 'badge badge-ai' }
      : diagramSource === 'blank'
        ? { label: 'Lienzo en blanco', className: 'badge' }
        : { label: 'Sin diagrama', className: 'badge' };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-left">
          <button
            type="button"
            className="tool-btn"
            onClick={() => setSidebarOpen((open) => !open)}
            aria-expanded={sidebarOpen}
            title={sidebarOpen ? 'Ocultar panel lateral' : 'Mostrar panel lateral'}
          >
            <PanelIcon />
          </button>
          <span className="brand-mark">
            <BrandIcon />
          </span>
          <h1 className="brand-title">IMR BPMN Studio</h1>
          <span className="badge">BPMN 2.0</span>
        </div>

        <div className="header-right">
          <span className={statusBadge.className}>{statusBadge.label}</span>
          <button type="button" className="tool-btn" onClick={handleCreateBlank} disabled={loading}>
            <PlusIcon />
            <span>Nuevo en blanco</span>
          </button>
        </div>
      </header>

      <main className="app-main">
        <aside className={`sidebar ${sidebarOpen ? '' : 'collapsed'}`}>
          <form onSubmit={handleSubmit}>
            <label htmlFor="process-description" className="field-label">
              <span>Descripción del proceso</span>
              <span className="char-count mono">{trimmedLength} / 4.000</span>
            </label>
            <textarea
              ref={textareaRef}
              id="process-description"
              className="process-textarea"
              placeholder="Describí los pasos, decisiones y resultados del proceso de negocio..."
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setActiveExampleId(null);
              }}
              onKeyDown={handleKeyDown}
              maxLength={4000}
              disabled={loading}
            />

            {trimmedLength === 0 && (
              <div className="examples-group">
                <span className="examples-label">Ejemplos precargados:</span>
                <div className="examples-list">
                  {PROCESS_EXAMPLES.map((example) => (
                    <button
                      key={example.id}
                      type="button"
                      className={`chip-btn ${activeExampleId === example.id ? 'active' : ''}`}
                      disabled={loading}
                      onClick={() => {
                        setDescription(example.description);
                        setActiveExampleId(example.id);
                        setError(null);
                      }}
                    >
                      {example.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button
              type="submit"
              className="primary-btn"
              disabled={loading || !isValidLength}
            >
              <SparklesIcon />
              <span>{loading ? 'Generando diagrama...' : 'Generar diagrama BPMN'}</span>
            </button>
            <div className="shortcut-hint">
              Atajo: <span className="mono">Ctrl + Enter</span> (mín. 10 caracteres)
            </div>
          </form>

          {error && (
            <div className="status-box status-error" role="alert">
              <span>{error}</span>
              <button
                type="button"
                className="retry-btn"
                onClick={() => void generateDiagram()}
                disabled={loading}
              >
                Reintentar
              </button>
            </div>
          )}

          {assumptions.length > 0 && (
            <div className="assumptions-box">
              <button
                type="button"
                className="assumptions-toggle"
                onClick={() => setAssumptionsOpen((open) => !open)}
                aria-expanded={assumptionsOpen}
              >
                <span>Supuestos asumidos ({assumptions.length})</span>
                <span>{assumptionsOpen ? '▾' : '▸'}</span>
              </button>
              {assumptionsOpen && (
                <ul>
                  {assumptions.map((item, idx) => (
                    <li key={idx}>
                      <strong>{item.question}</strong>
                      <div style={{ marginTop: 2 }}>{item.assumption}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {meta && (
            <div className="meta-badge mono">
              {meta.provider} · {meta.model} · {(meta.latencyMs / 1000).toFixed(1)}s
              {meta.repaired ? ' · auto-reparado' : ''}
            </div>
          )}
        </aside>

        <BpmnEditor
          xml={bpmnXml}
          blankTrigger={blankTrigger}
          loading={loading}
          elapsedSec={elapsedSec}
          onCreateBlank={handleCreateBlank}
          onDirtyChange={setIsDirty}
          onNotify={showToast}
        />
      </main>

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  );
}
