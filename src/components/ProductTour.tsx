'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from '@/components/Icons';

export const TOUR_STORAGE_KEY = 'imr_tour_completed_v1';

interface TourStep {
  target: string;
  title: string;
  description: string;
  placement: 'right' | 'left' | 'bottom-end';
}

const TOUR_STEPS: TourStep[] = [
  {
    target: '[data-tour="description-input"]',
    title: 'Describí tu proceso en lenguaje natural',
    description:
      'Escribí los pasos, decisiones y áreas responsables de tu negocio o elegí uno de los ejemplos precargados (Lineal, XOR, Paralelo o Colaboración) para comenzar al instante.',
    placement: 'right',
  },
  {
    target: '[data-tour="generate-controls"]',
    title: 'Generá y refiná sin perder tus cambios',
    description:
      'Elegí modo Rápido para borradores ágiles o Detallado para reglas complejas. Si editás el diagrama en el lienzo, podés refinar con IA conservando tus ajustes.',
    placement: 'right',
  },
  {
    target: '[data-tour="bpmn-canvas"]',
    title: 'Modelá en vivo con estándar BPMN 2.0',
    description:
      'Arrastrá tareas, compuertas y eventos desde la paleta izquierda, hacé doble clic para renombrar nodos y usá el zoom o Deshacer/Rehacer sobre un modelo BPMN 2.0 válido.',
    placement: 'left',
  },
  {
    target: '[data-tour="assumptions-tab"]',
    title: 'Auditá supuestos y recomendaciones BPMN',
    description:
      'La IA detecta ambigüedades de negocio y buenas prácticas BPMN. Hacé clic en cualquier tarjeta para enfocar el elemento en el diagrama, marcarlo como resuelto o re-analizar en vivo.',
    placement: 'right',
  },
  {
    target: '[data-tour="export-toolbar"]',
    title: 'Inspeccioná XML, importá y exportá',
    description:
      'Abrí el visor XML en tiempo real, importá archivos .bpmn propios o descargá tu diagrama final en .bpmn estándar o imagen vectorial .svg.',
    placement: 'bottom-end',
  },
];

interface RectBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface ProductTourProps {
  open: boolean;
  onClose: () => void;
  onBeforeStep?: (stepIndex: number) => void;
}

export default function ProductTour({ open, onClose, onBeforeStep }: ProductTourProps) {
  const [stepIdx, setStepIdx] = useState(0);
  const [rect, setRect] = useState<RectBox | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [popoverSize, setPopoverSize] = useState({ w: 348, h: 220 });

  const currentStep = TOUR_STEPS[stepIdx];

  const markCompletedAndClose = useCallback(() => {
    try {
      localStorage.setItem(TOUR_STORAGE_KEY, 'true');
    } catch {
      // Ignorar errores de almacenamiento
    }
    onClose();
  }, [onClose]);

  const measureTarget = useCallback(() => {
    if (!open || !currentStep) return;
    const el = document.querySelector(currentStep.target) as HTMLElement | null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;

    if (currentStep.target === '[data-tour="bpmn-canvas"]') {
      setRect({
        top: r.top + 8,
        left: r.left + 8,
        width: Math.max(180, r.width - 16),
        height: Math.max(180, r.height - 16),
      });
    } else {
      setRect({
        top: r.top - 5,
        left: r.left - 5,
        width: r.width + 10,
        height: r.height + 10,
      });
    }
  }, [open, currentStep]);

  useEffect(() => {
    if (!open) {
      setStepIdx(0);
      setRect(null);
      return;
    }

    onBeforeStep?.(stepIdx);
    const el = document.querySelector(currentStep.target) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    const raf = requestAnimationFrame(() => measureTarget());
    const timer = setTimeout(() => measureTarget(), 290);

    const onViewportChange = () => measureTarget();
    window.addEventListener('resize', onViewportChange, { passive: true });
    window.addEventListener('scroll', onViewportChange, { passive: true, capture: true });

    const targetEl = document.querySelector(currentStep.target);
    let observer: ResizeObserver | null = null;
    if (targetEl && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => measureTarget());
      observer.observe(targetEl);
    }

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, { capture: true });
      observer?.disconnect();
    };
  }, [open, stepIdx, currentStep.target, onBeforeStep, measureTarget]);

  useLayoutEffect(() => {
    if (!open || !popoverRef.current) return;
    const box = popoverRef.current.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) {
      setPopoverSize({ w: box.width, h: box.height });
    }
  }, [open, stepIdx, rect]);

  const hasRect = rect !== null;

  useEffect(() => {
    if (!open) return;
    if (hasRect) {
      popoverRef.current?.focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        markCompletedAndClose();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (stepIdx < TOUR_STEPS.length - 1) setStepIdx((s) => s + 1);
        else markCompletedAndClose();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (stepIdx > 0) setStepIdx((s) => s - 1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, stepIdx, hasRect, markCompletedAndClose]);

  if (!open || !rect) return null;

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const isMobile = vw <= 900;
  const gap = 14;

  let popTop = rect.top;
  let popLeft = rect.left;

  if (isMobile) {
    popLeft = Math.round((vw - popoverSize.w) / 2);
    const spaceBelow = vh - (rect.top + rect.height);
    if (spaceBelow >= popoverSize.h + gap + 12) {
      popTop = rect.top + rect.height + gap;
    } else {
      popTop = rect.top - popoverSize.h - gap;
    }
  } else if (currentStep.placement === 'right') {
    popLeft = rect.left + rect.width + gap;
    popTop = rect.top;
  } else if (currentStep.placement === 'left') {
    popLeft = rect.left + 24;
    popTop = rect.top + Math.max(24, (rect.height - popoverSize.h) / 2);
  } else {
    popLeft = rect.left + rect.width - popoverSize.w;
    popTop = rect.top + rect.height + gap;
  }

  const clampedLeft = Math.round(Math.max(12, Math.min(popLeft, vw - popoverSize.w - 12)));
  const clampedTop = Math.round(Math.max(12, Math.min(popTop, vh - popoverSize.h - 12)));
  const pct = Math.round(((stepIdx + 1) / TOUR_STEPS.length) * 100);
  const isLast = stepIdx === TOUR_STEPS.length - 1;

  return (
    <div className="tour-backdrop-layer" onClick={(e) => e.stopPropagation()}>
      <div
        className="tour-spotlight"
        style={{
          top: `${rect.top}px`,
          left: `${rect.left}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
        }}
      />
      <div
        ref={popoverRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-step-title"
        aria-describedby="tour-step-desc"
        tabIndex={-1}
        className="tour-popover"
        style={{ top: `${clampedTop}px`, left: `${clampedLeft}px` }}
      >
        <div className="tour-header">
          <span className="tour-step-badge mono">
            Paso {stepIdx + 1} de {TOUR_STEPS.length}
          </span>
          <button type="button" className="tour-skip-btn" onClick={markCompletedAndClose}>
            <span>Saltar</span>
            <XIcon />
          </button>
        </div>

        <div className="tour-progress-track" aria-hidden="true">
          <div className="tour-progress-fill" style={{ width: `${pct}%` }} />
        </div>

        <h3 id="tour-step-title" className="tour-title">
          {currentStep.title}
        </h3>
        <p id="tour-step-desc" className="tour-desc">
          {currentStep.description}
        </p>

        <div className="tour-footer">
          <button
            type="button"
            className="tool-btn"
            disabled={stepIdx === 0}
            onClick={() => setStepIdx((s) => Math.max(0, s - 1))}
          >
            <ChevronLeftIcon />
            <span>Anterior</span>
          </button>
          <button
            type="button"
            className="primary-btn tour-next-btn"
            onClick={() => {
              if (isLast) markCompletedAndClose();
              else setStepIdx((s) => s + 1);
            }}
          >
            <span>{isLast ? '¡Comenzar!' : 'Siguiente'}</span>
            {!isLast && <ChevronRightIcon />}
          </button>
        </div>
      </div>
    </div>
  );
}
