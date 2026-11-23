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
  fallbackUsed?: boolean;
  cached?: boolean;
  incremental?: boolean;
}

interface StructuredAssumption {
  question: string;
  assumption: string;
  impact?: 'high' | 'medium' | 'low';
  elementIds?: string[];
  sourceExcerpt?: string;
}

interface GenerateResponse {
  bpmnXml?: string;
  assumptions?: StructuredAssumption[];
  meta?: GenerateMeta;
  error?: string;
}

type DiagramSource = 'empty' | 'ai' | 'blank' | 'imported';
type SidebarTab = 'description' | 'assumptions';
type GenerationMode = 'detailed' | 'fast';

function renderHighlightedExcerpt(fullText: string, excerpt?: string) {
  const cleanExcerpt = excerpt?.trim();
  if (!cleanExcerpt) {
    return <span>Información omitida en la descripción original.</span>;
  }

  const lowerFull = fullText.toLowerCase();
  const lowerExcerpt = cleanExcerpt.toLowerCase();
  const idx = lowerFull.indexOf(lowerExcerpt);

  if (idx === -1) {
    return (
      <span>
        Referencia: <mark className="excerpt-mark">{cleanExcerpt}</mark>
      </span>
    );
  }

  const start = Math.max(0, idx - 45);
  const end = Math.min(fullText.length, idx + cleanExcerpt.length + 45);
  const before = (start > 0 ? '…' : '') + fullText.slice(start, idx);
  const match = fullText.slice(idx, idx + cleanExcerpt.length);
  const after = fullText.slice(idx + cleanExcerpt.length, end) + (end < fullText.length ? '…' : '');

  return (
    <span>
      {before}
      <mark className="excerpt-mark">{match}</mark>
      {after}
    </span>
  );
}

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<SidebarTab>('description');
  const [generationMode, setGenerationMode] = useState<GenerationMode>('detailed');
  const [description, setDescription] = useState('');
  const [activeExampleId, setActiveExampleId] = useState<string | null>(null);
  const [bpmnXml, setBpmnXml] = useState<string | null>(null);
  const [blankTrigger, setBlankTrigger] = useState(0);
  const [diagramSource, setDiagramSource] = useState<DiagramSource>('empty');
  const [isDirty, setIsDirty] = useState(false);
  const [assumptions, setAssumptions] = useState<StructuredAssumption[]>([]);
  const [activeAssumptionIdx, setActiveAssumptionIdx] = useState<number | null>(null);
  const [showSecondaryAssumptions, setShowSecondaryAssumptions] = useState(false);
  const [meta, setMeta] = useState<GenerateMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(380);
  const [isResizing, setIsResizing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const xmlGetterRef = useRef<(() => Promise<string | null>) | null>(null);

  const trimmedLength = description.trim().length;
  const isValidLength = trimmedLength >= 10 && trimmedLength <= 4000;

  const highlightedElementIds =
    activeAssumptionIdx !== null ? assumptions[activeAssumptionIdx]?.elementIds || [] : [];

  const allAssumptionElementIds = assumptions.flatMap((a) => a.elementIds || []);

  const handleElementSelectAssumption = useCallback(
    (elementId: string) => {
      const matchIdx = assumptions.findIndex((a) => (a.elementIds || []).includes(elementId));
      if (matchIdx !== -1) {
        setActiveTab('assumptions');
        setSidebarOpen(true);
        setActiveAssumptionIdx(matchIdx);
      }
    },
    [assumptions]
  );

  useEffect(() => {
    if (!isResizing) return;
    const onMouseMove = (e: MouseEvent) => {
      const next = Math.max(280, Math.min(620, e.clientX));
      setSidebarWidth(next);
    };
    const onMouseUp = () => setIsResizing(false);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isResizing]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 440)}px`;
  }, [description, activeTab]);

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

  const handleEditExcerptInText = (excerpt?: string) => {
    setActiveTab('description');
    setTimeout(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const clean = excerpt?.trim();
      if (clean) {
        const idx = description.toLowerCase().indexOf(clean.toLowerCase());
        if (idx !== -1) {
          el.setSelectionRange(idx, idx + clean.length);
          return;
        }
      }
      el.setSelectionRange(description.length, description.length);
    }, 40);
  };

  const confirmOverwriteIfDirty = (): boolean => {
    if (!isDirty) return true;
    return window.confirm(
      'Tenés cambios manuales en el diagrama actual. ¿Querés reemplazarlo?'
    );
  };

  const handleImportBpmn = useCallback(
    (xml: string, filename: string) => {
      if (
        isDirty &&
        !window.confirm('Tenés cambios manuales en el diagrama actual. ¿Querés reemplazarlo?')
      ) {
        return;
      }
      setBpmnXml(xml);
      setAssumptions([]);
      setActiveAssumptionIdx(null);
      setMeta(null);
      setError(null);
      setDiagramSource('imported');
      showToast(`Diagrama "${filename}" importado.`);
    },
    [isDirty, showToast]
  );

  const handleCreateBlank = useCallback(() => {
    if (
      isDirty &&
      !window.confirm('Tenés cambios manuales en el diagrama actual. ¿Querés iniciar uno en blanco?')
    ) {
      return;
    }
    setBpmnXml(null);
    setAssumptions([]);
    setActiveAssumptionIdx(null);
    setMeta(null);
    setError(null);
    setDiagramSource('blank');
    setBlankTrigger((prev) => prev + 1);
  }, [isDirty]);

  const generateDiagram = async (requestedMode?: 'fresh' | 'preserve-edits') => {
    if (!isValidLength || loading) {
      if (!isValidLength) {
        setError('Ingresá una descripción de entre 10 y 4.000 caracteres.');
      }
      return;
    }

    const iterationMode: 'fresh' | 'preserve-edits' =
      requestedMode ?? (isDirty ? 'preserve-edits' : 'fresh');

    if (iterationMode === 'fresh' && isDirty) {
      const ok = window.confirm(
        'Tenés cambios manuales en el diagrama actual. ¿Querés descartarlos y regenerar desde cero?'
      );
      if (!ok) return;
    }

    setLoading(true);
    setError(null);
    setActiveAssumptionIdx(null);

    try {
      const liveXml =
        iterationMode === 'preserve-edits' ? await xmlGetterRef.current?.() : null;

      const res = await fetch('/api/generate-bpmn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          processDescription: description.trim(),
          previousBpmnXml: liveXml || undefined,
          mode: generationMode,
          iterationMode,
        }),
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

      const nextAssumptions = data.assumptions || [];
      setBpmnXml(data.bpmnXml);
      setAssumptions(nextAssumptions);
      setShowSecondaryAssumptions(false);
      setMeta(data.meta || null);
      setDiagramSource('ai');
      if (nextAssumptions.length > 0) {
        setActiveTab('assumptions');
      }
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
        : diagramSource === 'imported'
          ? { label: 'Importado (.bpmn)', className: 'badge' }
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
        <aside
          className={`sidebar ${sidebarOpen ? '' : 'collapsed'} ${isResizing ? 'resizing' : ''}`}
          style={sidebarOpen ? { width: `${sidebarWidth}px` } : undefined}
        >
          <div className="sidebar-tabs" role="tablist" aria-label="Secciones del panel">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'description'}
              className={`tab-btn ${activeTab === 'description' ? 'active' : ''}`}
              onClick={() => setActiveTab('description')}
            >
              Descripción
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'assumptions'}
              className={`tab-btn ${activeTab === 'assumptions' ? 'active' : ''}`}
              onClick={() => setActiveTab('assumptions')}
            >
              Supuestos ({assumptions.length})
            </button>
          </div>

          {activeTab === 'description' ? (
            <>
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

                <div className="sidebar-tabs" style={{ marginTop: 10, marginBottom: 10 }} role="group" aria-label="Modo de generación">
                  <button
                    type="button"
                    className={`tab-btn ${generationMode === 'detailed' ? 'active' : ''}`}
                    disabled={loading}
                    onClick={() => setGenerationMode('detailed')}
                  >
                    Detallado
                  </button>
                  <button
                    type="button"
                    className={`tab-btn ${generationMode === 'fast' ? 'active' : ''}`}
                    disabled={loading}
                    onClick={() => setGenerationMode('fast')}
                  >
                    Rápido
                  </button>
                </div>

                <button
                  type="submit"
                  className="primary-btn"
                  disabled={loading || !isValidLength}
                >
                  <SparklesIcon />
                  <span>
                    {loading
                      ? 'Generando diagrama...'
                      : isDirty
                        ? 'Refinar conservando mis ediciones'
                        : bpmnXml
                          ? 'Regenerar diagrama BPMN'
                          : 'Generar diagrama BPMN'}
                  </span>
                </button>
                {isDirty && (
                  <button
                    type="button"
                    className="tool-btn"
                    style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
                    disabled={loading || !isValidLength}
                    onClick={() => void generateDiagram('fresh')}
                  >
                    Regenerar desde cero (descartar ediciones)
                  </button>
                )}
                <div className="shortcut-hint">
                  Atajo: <span className="mono">Ctrl + Enter</span> · Editá la descripción completa
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
            </>
          ) : (
            <div className="assumptions-list">
              {assumptions.length === 0 ? (
                <div className="excerpt-box">
                  Todavía no hay supuestos registrados. Generá un diagrama desde la solapa{' '}
                  <strong>Descripción</strong> para analizar ambigüedades y trazabilidad.
                </div>
              ) : (
                <>
                  <div className="examples-label">
                    Hacé clic en una tarjeta para enfocar y resaltar los elementos en el diagrama:
                  </div>
                  {(() => {
                    const indexed = assumptions.map((item, idx) => ({ item, idx }));
                    const primary = indexed.filter(({ item }) => item.impact === 'high');
                    const secondary = indexed.filter(({ item }) => item.impact !== 'high');
                    const visible =
                      primary.length === 0 || showSecondaryAssumptions ? indexed : primary;

                    const renderCard = ({ item, idx }: { item: StructuredAssumption; idx: number }) => {
                      const isActive = activeAssumptionIdx === idx;
                      const count = item.elementIds?.length || 0;
                      const impactLabel =
                        item.impact === 'high'
                          ? 'Alto impacto'
                          : item.impact === 'low'
                            ? 'Detalle menor'
                            : 'Impacto medio';
                      return (
                        <button
                          key={idx}
                          type="button"
                          className={`assumption-card ${isActive ? 'active' : ''}`}
                          onClick={() => setActiveAssumptionIdx(isActive ? null : idx)}
                        >
                          <div className="assumption-top">
                            <span className={`impact-pill impact-${item.impact || 'medium'}`}>
                              {impactLabel}
                            </span>
                          </div>
                          <div className="assumption-question">{item.question}</div>
                          <div className="assumption-answer">{item.assumption}</div>
                          <div className="assumption-meta">
                            <span>
                              {count > 0
                                ? `${count} elemento${count > 1 ? 's' : ''} en el diagrama`
                                : 'Supuesto general del proceso'}
                            </span>
                            <span>{isActive ? 'Resaltado ✓' : 'Ubicar →'}</span>
                          </div>
                          {isActive && (
                            <div className="excerpt-box">
                              <div>{renderHighlightedExcerpt(description, item.sourceExcerpt)}</div>
                              <button
                                type="button"
                                className="tool-btn"
                                style={{ marginTop: 8 }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleEditExcerptInText(item.sourceExcerpt);
                                }}
                              >
                                Ir al texto para editar →
                              </button>
                            </div>
                          )}
                        </button>
                      );
                    };

                    return (
                      <>
                        {visible.map(renderCard)}
                        {primary.length > 0 && secondary.length > 0 && (
                          <button
                            type="button"
                            className="tool-btn"
                            style={{ width: '100%', justifyContent: 'center' }}
                            onClick={() => setShowSecondaryAssumptions((s) => !s)}
                          >
                            {showSecondaryAssumptions
                              ? 'Ocultar supuestos secundarios'
                              : `Ver ${secondary.length} supuesto${secondary.length > 1 ? 's' : ''} secundario${secondary.length > 1 ? 's' : ''}`}
                          </button>
                        )}
                      </>
                    );
                  })()}
                </>
              )}
            </div>
          )}

          {meta && (
            <div className="meta-badge mono">
              {meta.provider} · {meta.model} · {(meta.latencyMs / 1000).toFixed(1)}s
              {meta.cached ? ' · caché' : ''}
              {meta.incremental ? ' · refinado' : ''}
              {meta.fallbackUsed ? ' · fallback' : ''}
              {meta.repaired ? ' · auto-reparado' : ''}
            </div>
          )}
        </aside>

        {sidebarOpen && (
          <div
            className={`resize-handle ${isResizing ? 'dragging' : ''}`}
            role="separator"
            aria-orientation="vertical"
            aria-label="Ajustar ancho del panel lateral"
            onMouseDown={() => setIsResizing(true)}
          />
        )}

        <BpmnEditor
          xml={bpmnXml}
          blankTrigger={blankTrigger}
          loading={loading}
          elapsedSec={elapsedSec}
          highlightedElementIds={highlightedElementIds}
          assumptionElementIds={allAssumptionElementIds}
          onElementSelectAssumption={handleElementSelectAssumption}
          onImportBpmn={handleImportBpmn}
          xmlGetterRef={xmlGetterRef}
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
