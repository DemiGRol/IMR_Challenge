'use client';

import dynamic from 'next/dynamic';
import { FormEvent, KeyboardEvent, MouseEvent as ReactMouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  AlertCircleIcon,
  BrandIcon,
  CheckIcon,
  HelpCircleIcon,
  MoonIcon,
  PanelIcon,
  PlusIcon,
  SparklesIcon,
  SunIcon,
} from '@/components/Icons';
import { PROCESS_EXAMPLES } from '@/components/ProcessExamples';
import ProductTour, { TOUR_STORAGE_KEY } from '@/components/ProductTour';

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

interface ModelingRecommendation {
  title: string;
  explanation: string;
  elementIds?: string[];
}

interface GenerateResponse {
  bpmnXml?: string;
  assumptions?: StructuredAssumption[];
  recommendations?: ModelingRecommendation[];
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

function stripBpmnDi(xml: string): string {
  return xml
    .replace(/<(?:[a-zA-Z0-9_-]+:)?BPMNDiagram[\s\S]*?<\/(?:[a-zA-Z0-9_-]+:)?BPMNDiagram>/gi, '')
    .trim();
}

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<SidebarTab>('description');
  const [generationMode, setGenerationMode] = useState<GenerationMode>('fast');
  const [description, setDescription] = useState('');
  const [activeExampleId, setActiveExampleId] = useState<string | null>(null);
  const [bpmnXml, setBpmnXml] = useState<string | null>(null);
  const [loadRevision, setLoadRevision] = useState(0);
  const [blankTrigger, setBlankTrigger] = useState(0);
  const [diagramSource, setDiagramSource] = useState<DiagramSource>('empty');
  const [isDirty, setIsDirty] = useState(false);
  const [assumptions, setAssumptions] = useState<StructuredAssumption[]>([]);
  const [recommendations, setRecommendations] = useState<ModelingRecommendation[]>([]);
  const [resolvedIndices, setResolvedIndices] = useState<number[]>([]);
  const [resolvedHistory, setResolvedHistory] = useState<string[]>([]);
  const [showResolvedAssumptions, setShowResolvedAssumptions] = useState(false);
  const [activeAssumptionIdx, setActiveAssumptionIdx] = useState<number | null>(null);
  const [activeRecommendationIdx, setActiveRecommendationIdx] = useState<number | null>(null);
  const [showSecondaryAssumptions, setShowSecondaryAssumptions] = useState(false);
  const [meta, setMeta] = useState<GenerateMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(380);
  const [isResizing, setIsResizing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [fontSize, setFontSize] = useState<'sm' | 'md' | 'lg'>('md');
  const [tourOpen, setTourOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const xmlGetterRef = useRef<(() => Promise<string | null>) | null>(null);
  const pendingImportRef = useRef<{ filename: string; prevSource: DiagramSource } | null>(null);

  useEffect(() => {
    const currentTheme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    setTheme(currentTheme);

    const dsFont = document.documentElement.dataset.fontSize;
    if (dsFont === 'sm' || dsFont === 'md' || dsFont === 'lg') {
      setFontSize(dsFont);
    }

    let timerId: number | undefined;
    try {
      if (window.localStorage.getItem(TOUR_STORAGE_KEY) !== 'true') {
        timerId = window.setTimeout(() => setTourOpen(true), 500);
      }
    } catch {
      // Ignora restricciones de localStorage.
    }
    return () => {
      if (timerId !== undefined) window.clearTimeout(timerId);
    };
  }, []);

  const handleFontSizeChange = useCallback((nextSize: 'sm' | 'md' | 'lg') => {
    document.documentElement.dataset.fontSize = nextSize;
    try {
      window.localStorage.setItem('imr_font_size', nextSize);
    } catch {
      // Ignora errores de almacenamiento.
    }
    setFontSize(nextSize);
  }, []);

  const handleToggleTheme = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      const nextTheme = theme === 'dark' ? 'light' : 'dark';
      const root = document.documentElement;
      const rect = event.currentTarget.getBoundingClientRect();
      const x = rect.width > 0 ? rect.left + rect.width / 2 : window.innerWidth - 60;
      const y = rect.height > 0 ? rect.top + rect.height / 2 : 28;
      root.style.setProperty('--theme-x', `${x}px`);
      root.style.setProperty('--theme-y', `${y}px`);

      const applyTheme = () => {
        root.dataset.theme = nextTheme;
        try {
          window.localStorage.setItem('imr_theme', nextTheme);
        } catch {
          // Ignora errores de almacenamiento.
        }
        setTheme(nextTheme);
      };

      const prefersReduced =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      type ViewTransitionDoc = Document & {
        startViewTransition?: (cb: () => void) => { ready: Promise<void> };
      };
      const doc = document as ViewTransitionDoc;

      if (!prefersReduced && typeof doc.startViewTransition === 'function') {
        doc.startViewTransition(() => {
          flushSync(() => {
            applyTheme();
          });
        });
        return;
      }

      root.classList.add('theme-transitioning');
      applyTheme();
      window.setTimeout(() => root.classList.remove('theme-transitioning'), 340);
    },
    [theme]
  );

  const handleBeforeTourStep = useCallback((stepIndex: number) => {
    if (stepIndex === 0 || stepIndex === 1) {
      setSidebarOpen(true);
      setActiveTab('description');
    } else if (stepIndex === 3) {
      setSidebarOpen(true);
      setActiveTab('assumptions');
    }
  }, []);

  const handleFocusDescription = useCallback(() => {
    setSidebarOpen(true);
    setActiveTab('description');
    window.setTimeout(() => textareaRef.current?.focus(), 60);
  }, []);

  const trimmedLength = description.trim().length;
  const isValidLength = trimmedLength >= 10 && trimmedLength <= 4000;

  const resolvedSet = new Set(resolvedIndices);
  const pendingAssumptionsCount = assumptions.filter((_, idx) => !resolvedSet.has(idx)).length;

  const highlightedElementIds =
    activeAssumptionIdx !== null
      ? assumptions[activeAssumptionIdx]?.elementIds || []
      : activeRecommendationIdx !== null
        ? recommendations[activeRecommendationIdx]?.elementIds || []
        : [];

  const allAssumptionElementIds = [
    ...assumptions
      .filter((_, idx) => !resolvedSet.has(idx))
      .flatMap((a) => a.elementIds || []),
    ...recommendations.flatMap((r) => r.elementIds || []),
  ];

  const handleElementSelectAssumption = useCallback(
    (elementId: string) => {
      const matchIdx = assumptions.findIndex((a) => (a.elementIds || []).includes(elementId));
      if (matchIdx !== -1) {
        setActiveTab('assumptions');
        setSidebarOpen(true);
        setActiveRecommendationIdx(null);
        setActiveAssumptionIdx(matchIdx);
        return;
      }
      const recIdx = recommendations.findIndex((r) => (r.elementIds || []).includes(elementId));
      if (recIdx !== -1) {
        setActiveTab('assumptions');
        setSidebarOpen(true);
        setActiveAssumptionIdx(null);
        setActiveRecommendationIdx(recIdx);
      }
    },
    [assumptions, recommendations]
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

  const handleImportBpmn = useCallback(
    (xml: string, filename: string) => {
      if (
        isDirty &&
        !window.confirm('Tenés cambios manuales en el diagrama actual. ¿Querés reemplazarlo?')
      ) {
        return;
      }
      pendingImportRef.current = { filename, prevSource: diagramSource };
      setBpmnXml(xml);
      setLoadRevision((prev) => prev + 1);
    },
    [diagramSource, isDirty]
  );

  const handleImportResult = useCallback(
    (ok: boolean) => {
      const pending = pendingImportRef.current;
      if (!pending) return;
      pendingImportRef.current = null;
      if (ok) {
        setAssumptions([]);
        setRecommendations([]);
        setResolvedIndices([]);
        setResolvedHistory([]);
        setShowResolvedAssumptions(false);
        setActiveAssumptionIdx(null);
        setActiveRecommendationIdx(null);
        setMeta(null);
        setError(null);
        setDiagramSource('imported');
        showToast(`Diagrama "${pending.filename}" importado.`);
      } else {
        setDiagramSource(pending.prevSource === 'imported' ? 'empty' : pending.prevSource);
        showToast(`No se pudo cargar "${pending.filename}" en el editor.`);
      }
    },
    [showToast]
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
    setRecommendations([]);
    setResolvedIndices([]);
    setResolvedHistory([]);
    setShowResolvedAssumptions(false);
    setActiveAssumptionIdx(null);
    setActiveRecommendationIdx(null);
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
    setActiveRecommendationIdx(null);

    try {
      const liveXml =
        iterationMode === 'preserve-edits' ? await xmlGetterRef.current?.() : null;
      const semanticPreviousXml = liveXml ? stripBpmnDi(liveXml) : undefined;

      const res = await fetch('/api/generate-bpmn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          processDescription: description.trim(),
          previousBpmnXml: semanticPreviousXml || undefined,
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
      const nextRecommendations = data.recommendations || [];
      pendingImportRef.current = null;
      setBpmnXml(data.bpmnXml);
      setLoadRevision((prev) => prev + 1);
      setAssumptions(nextAssumptions);
      setRecommendations(nextRecommendations);
      setResolvedIndices([]);
      if (iterationMode === 'fresh') {
        setResolvedHistory([]);
      }
      setShowResolvedAssumptions(false);
      setShowSecondaryAssumptions(false);
      setMeta(data.meta || null);
      setDiagramSource('ai');
      if (nextAssumptions.length > 0 || nextRecommendations.length > 0) {
        setActiveTab('assumptions');
      }
    } catch {
      setError('Error de conexión con el servidor. Verificá tu red e intentá nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleResolvedAssumption = (idx: number) => {
    const question = assumptions[idx]?.question?.trim();
    const isResolved = resolvedIndices.includes(idx);
    if (isResolved) {
      setResolvedIndices((prev) => prev.filter((i) => i !== idx));
      if (question) {
        setResolvedHistory((prev) => prev.filter((q) => q !== question));
      }
    } else {
      setResolvedIndices((prev) => [...prev, idx]);
      if (question) {
        setResolvedHistory((prev) => (prev.includes(question) ? prev : [...prev, question]));
      }
      if (activeAssumptionIdx === idx) {
        setActiveAssumptionIdx(null);
      }
    }
  };

  const handleReanalyzeDiagram = async () => {
    if (analyzing || loading || diagramSource === 'empty') return;
    setAnalyzing(true);
    setError(null);
    setActiveAssumptionIdx(null);
    setActiveRecommendationIdx(null);

    try {
      const liveXml = await xmlGetterRef.current?.();
      if (!liveXml) {
        showToast('No se pudo leer el diagrama BPMN actual para analizar.');
        return;
      }

      const compactXml = stripBpmnDi(liveXml);
      const res = await fetch('/api/analyze-bpmn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentBpmnXml: compactXml,
          processDescription: description.trim(),
          resolvedQuestions: resolvedHistory.slice(-30),
          mode: generationMode,
        }),
      });

      let data: {
        assumptions?: StructuredAssumption[];
        recommendations?: ModelingRecommendation[];
        meta?: GenerateMeta;
        error?: string;
      } = {};
      try {
        data = (await res.json()) as typeof data;
      } catch {
        showToast(
          res.status === 504
            ? 'El análisis superó el tiempo máximo de espera del servidor.'
            : 'El servidor devolvió una respuesta inesperada al analizar.'
        );
        return;
      }
      if (!res.ok) {
        showToast(data.error || 'No se pudo re-analizar el diagrama actual.');
        return;
      }

      const nextAssumptions = data.assumptions || [];
      const nextRecommendations = data.recommendations || [];
      setAssumptions(nextAssumptions);
      setRecommendations(nextRecommendations);
      setResolvedIndices([]);
      setShowResolvedAssumptions(false);
      setShowSecondaryAssumptions(false);
      if (data.meta) {
        setMeta({ ...data.meta, incremental: true });
      }
      showToast(
        nextAssumptions.length === 0 && nextRecommendations.length === 0
          ? 'No se detectaron nuevos supuestos ni observaciones BPMN.'
          : `Análisis actualizado: ${nextAssumptions.length} supuesto${nextAssumptions.length === 1 ? '' : 's'} y ${nextRecommendations.length} recomendación${nextRecommendations.length === 1 ? '' : 'es'}.`
      );
    } catch {
      showToast('Error de conexión al re-analizar el diagrama.');
    } finally {
      setAnalyzing(false);
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

  const hasDiagram = diagramSource !== 'empty' && (Boolean(bpmnXml) || blankTrigger > 0);
  const activeStep =
    activeTab === 'assumptions' && hasDiagram ? 3 : hasDiagram ? 2 : 1;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-left">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setSidebarOpen((open) => !open)}
            aria-expanded={sidebarOpen}
            title={sidebarOpen ? 'Ocultar panel lateral' : 'Mostrar panel lateral'}
            aria-label={sidebarOpen ? 'Ocultar panel lateral' : 'Mostrar panel lateral'}
          >
            <PanelIcon />
          </button>
          <span className="brand-mark">
            <BrandIcon />
          </span>
          <h1 className="brand-title">IMR BPMN Studio</h1>
          <span className="badge header-label-desktop">BPMN 2.0</span>
        </div>

        <nav className="workflow-stepper" aria-label="Flujo de trabajo">
          <button
            type="button"
            className={`step-pill ${activeStep === 1 ? 'active' : ''} ${
              activeStep > 1 || trimmedLength >= 10 ? 'done' : ''
            }`}
            onClick={handleFocusDescription}
          >
            <span className="step-num">1</span>
            <span>Describir</span>
          </button>
          <span className="step-line" aria-hidden="true" />
          <button
            type="button"
            className={`step-pill ${activeStep === 2 ? 'active' : ''} ${
              hasDiagram && activeStep > 2 ? 'done' : ''
            }`}
            onClick={() => {
              if (!hasDiagram && isValidLength && !loading) {
                void generateDiagram();
              } else {
                setActiveTab('description');
              }
            }}
          >
            <span className="step-num">2</span>
            <span>Modelar</span>
          </button>
          <span className="step-line" aria-hidden="true" />
          <button
            type="button"
            className={`step-pill ${activeStep === 3 ? 'active' : ''} ${
              hasDiagram && assumptions.length > 0 && pendingAssumptionsCount === 0 ? 'done' : ''
            }`}
            onClick={() => {
              setSidebarOpen(true);
              setActiveTab('assumptions');
            }}
          >
            <span className="step-num">3</span>
            <span>Auditar</span>
            {pendingAssumptionsCount > 0 && (
              <span className="step-count">{pendingAssumptionsCount}</span>
            )}
          </button>
        </nav>

        <div className="header-right">
          <span className={statusBadge.className}>
            <span className="status-dot" aria-hidden="true" />
            <span>{statusBadge.label}</span>
          </span>
          <button
            type="button"
            className="tool-btn"
            onClick={() => setTourOpen(true)}
            title="Abrir guía interactiva de la plataforma"
          >
            <HelpCircleIcon />
            <span className="header-label-desktop">Guía</span>
          </button>
          <div className="font-size-control" role="group" aria-label="Tamaño de texto">
            <button
              type="button"
              className="font-size-btn size-sm"
              aria-pressed={fontSize === 'sm'}
              onClick={() => handleFontSizeChange('sm')}
              title="Texto chico"
              aria-label="Texto chico"
            >
              A
            </button>
            <button
              type="button"
              className="font-size-btn size-md"
              aria-pressed={fontSize === 'md'}
              onClick={() => handleFontSizeChange('md')}
              title="Texto mediano (predeterminado)"
              aria-label="Texto mediano"
            >
              A
            </button>
            <button
              type="button"
              className="font-size-btn size-lg"
              aria-pressed={fontSize === 'lg'}
              onClick={() => handleFontSizeChange('lg')}
              title="Texto grande"
              aria-label="Texto grande"
            >
              A
            </button>
          </div>
          <button
            type="button"
            className="icon-btn theme-toggle"
            onClick={handleToggleTheme}
            aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
            title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
          <button type="button" className="tool-btn" onClick={handleCreateBlank} disabled={loading}>
            <PlusIcon />
            <span className="header-label-desktop">Nuevo en blanco</span>
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
              data-tour="assumptions-tab"
              aria-selected={activeTab === 'assumptions'}
              className={`tab-btn ${activeTab === 'assumptions' ? 'active' : ''}`}
              onClick={() => setActiveTab('assumptions')}
            >
              <span>Supuestos</span>
              {(pendingAssumptionsCount > 0 || recommendations.length > 0) && (
                <span className="badge-count">
                  {pendingAssumptionsCount}
                  {recommendations.length > 0 ? `+${recommendations.length}` : ''}
                </span>
              )}
            </button>
          </div>

          {activeTab === 'description' ? (
            <>
              <form onSubmit={handleSubmit}>
                <div data-tour="description-input">
                  <label htmlFor="process-description" className="field-label">
                    <span>Descripción del proceso</span>
                    <span className={`char-count mono ${isValidLength ? 'valid' : ''}`}>
                      {trimmedLength} / 4.000
                    </span>
                  </label>
                  <div className="textarea-shell">
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
                  </div>

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
                </div>

                <div data-tour="generate-controls">
                  <div className="sidebar-tabs" style={{ marginTop: 12, marginBottom: 8 }} role="group" aria-label="Modo de generación">
                    <button
                      type="button"
                      className={`tab-btn ${generationMode === 'fast' ? 'active' : ''}`}
                      disabled={loading}
                      onClick={() => setGenerationMode('fast')}
                    >
                      Rápido
                    </button>
                    <button
                      type="button"
                      className={`tab-btn ${generationMode === 'detailed' ? 'active' : ''}`}
                      disabled={loading}
                      onClick={() => setGenerationMode('detailed')}
                    >
                      Detallado
                    </button>
                  </div>
                  <p className="mode-hint">
                    {generationMode === 'fast'
                      ? 'Menor latencia y costo; ideal para primeros borradores e iteraciones frecuentes.'
                      : 'Mayor profundidad de razonamiento para reglas complejas o descripciones ambiguas.'}
                  </p>

                  <button
                    type="submit"
                    className={`primary-btn ${loading ? 'is-loading' : ''}`}
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
                      className="tool-btn ghost-danger-btn"
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
                </div>
              </form>

              {error && (
                <div className="status-box status-error" role="alert">
                  <AlertCircleIcon />
                  <span style={{ flex: 1 }}>{error}</span>
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
              {diagramSource !== 'empty' && (
                <div
                  className={`reanalyze-box ${
                    (assumptions.length > 0 && pendingAssumptionsCount === 0) || isDirty
                      ? 'ready'
                      : ''
                  }`}
                >
                  <div className="reanalyze-hint">
                    {assumptions.length > 0 && pendingAssumptionsCount === 0
                      ? 'Todos los supuestos fueron marcados como resueltos. Podés auditar si quedan nuevas ambigüedades sobre el diagrama actual.'
                      : isDirty
                        ? 'Hay ediciones manuales en el diagrama. Podés re-analizar la versión en vivo sin sobrescribir el dibujo.'
                        : 'Auditá supuestos pendientes y recomendaciones sobre el diagrama actual.'}
                  </div>
                  <button
                    type="button"
                    className="tool-btn"
                    style={{ width: '100%', justifyContent: 'center' }}
                    disabled={analyzing || loading}
                    onClick={() => void handleReanalyzeDiagram()}
                  >
                    <SparklesIcon />
                    <span>
                      {analyzing ? 'Analizando diagrama actual...' : 'Re-analizar diagrama actual'}
                    </span>
                  </button>
                </div>
              )}

              {assumptions.length === 0 && recommendations.length === 0 ? (
                <div className="excerpt-box">
                  Todavía no hay supuestos registrados. Generá un diagrama desde la solapa{' '}
                  <strong>Descripción</strong> o usá <strong>Re-analizar diagrama actual</strong> si ya cargaste o editaste uno.
                </div>
              ) : (
                <>
                  {recommendations.length > 0 && (
                    <div className="recommendations-section">
                      <div className="examples-label">
                        Recomendaciones BPMN ({recommendations.length}):
                      </div>
                      {recommendations.map((rec, rIdx) => {
                        const isRecActive = activeRecommendationIdx === rIdx;
                        const recCount = rec.elementIds?.length || 0;
                        return (
                          <button
                            key={`rec-${rIdx}`}
                            type="button"
                            className={`assumption-card recommendation-card ${isRecActive ? 'active' : ''}`}
                            onClick={() => {
                              setActiveAssumptionIdx(null);
                              setActiveRecommendationIdx(isRecActive ? null : rIdx);
                            }}
                          >
                            <div className="assumption-top">
                              <span className="impact-pill impact-info">Recomendación BPMN</span>
                            </div>
                            <div className="assumption-question">{rec.title}</div>
                            <div className="assumption-answer">{rec.explanation}</div>
                            <div className="assumption-meta">
                              <span>
                                {recCount > 0
                                  ? `${recCount} elemento${recCount > 1 ? 's' : ''} en el diagrama`
                                  : 'Sugerencia general de modelado'}
                              </span>
                              <span>{isRecActive ? 'Resaltado ✓' : 'Ubicar →'}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {pendingAssumptionsCount > 0 && (
                    <div className="examples-label">
                      Hacé clic en una tarjeta para enfocar los elementos en el diagrama:
                    </div>
                  )}
                  {(() => {
                    const indexed = assumptions.map((item, idx) => ({ item, idx }));
                    const pending = indexed.filter(({ idx }) => !resolvedSet.has(idx));
                    const resolvedItems = indexed.filter(({ idx }) => resolvedSet.has(idx));
                    const primary = pending.filter(({ item }) => item.impact === 'high');
                    const secondary = pending.filter(({ item }) => item.impact !== 'high');
                    const visible =
                      primary.length === 0 || showSecondaryAssumptions ? pending : primary;

                    const renderCard = (
                      { item, idx }: { item: StructuredAssumption; idx: number },
                      isResolved: boolean
                    ) => {
                      const isActive = activeAssumptionIdx === idx;
                      const count = item.elementIds?.length || 0;
                      const impactLabel =
                        item.impact === 'high'
                          ? 'Alto impacto'
                          : item.impact === 'low'
                            ? 'Detalle menor'
                            : 'Impacto medio';
                      const toggleCard = () => {
                        setActiveRecommendationIdx(null);
                        setActiveAssumptionIdx(isActive ? null : idx);
                      };
                      return (
                        <div
                          key={idx}
                          role="button"
                          tabIndex={0}
                          className={`assumption-card impact-border-${item.impact || 'medium'} ${isActive ? 'active' : ''} ${isResolved ? 'resolved' : ''}`}
                          onClick={toggleCard}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              toggleCard();
                            }
                          }}
                        >
                          <div className="assumption-top">
                            <span className={`impact-pill impact-${item.impact || 'medium'}`}>
                              {impactLabel}
                            </span>
                            <div className="assumption-actions">
                              <button
                                type="button"
                                className="resolve-btn"
                                title={
                                  isResolved
                                    ? 'Volver a marcar este supuesto como pendiente'
                                    : 'Marcar como resuelto en el seguimiento (no modifica el diagrama automáticamente)'
                                }
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleResolvedAssumption(idx);
                                }}
                              >
                                {isResolved ? (
                                  'Reabrir'
                                ) : (
                                  <>
                                    <CheckIcon />
                                    <span>Marcar como resuelto</span>
                                  </>
                                )}
                              </button>
                            </div>
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
                        </div>
                      );
                    };

                    return (
                      <>
                        {visible.map((entry) => renderCard(entry, false))}
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
                        {resolvedItems.length > 0 && (
                          <div className="resolved-section">
                            <button
                              type="button"
                              className="tool-btn"
                              style={{ width: '100%', justifyContent: 'center' }}
                              onClick={() => setShowResolvedAssumptions((s) => !s)}
                            >
                              {showResolvedAssumptions
                                ? `Ocultar resueltos (${resolvedItems.length})`
                                : `Ver supuestos resueltos (${resolvedItems.length})`}
                            </button>
                            {showResolvedAssumptions &&
                              resolvedItems.map((entry) => renderCard(entry, true))}
                          </div>
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
          loadRevision={loadRevision}
          blankTrigger={blankTrigger}
          loading={loading}
          elapsedSec={elapsedSec}
          highlightedElementIds={highlightedElementIds}
          assumptionElementIds={allAssumptionElementIds}
          onElementSelectAssumption={handleElementSelectAssumption}
          onImportBpmn={handleImportBpmn}
          onImportResult={handleImportResult}
          xmlGetterRef={xmlGetterRef}
          onCreateBlank={handleCreateBlank}
          onFocusDescription={handleFocusDescription}
          onDirtyChange={setIsDirty}
          onNotify={showToast}
        />
      </main>

      <ProductTour
        open={tourOpen}
        onClose={() => setTourOpen(false)}
        onBeforeStep={handleBeforeTourStep}
      />

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  );
}
