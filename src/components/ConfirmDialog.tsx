'use client';

import { useEffect, useRef } from 'react';
import { AlertCircleIcon, XIcon } from '@/components/Icons';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  detail?: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'warning';
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  description,
  detail,
  confirmLabel,
  cancelLabel = 'Cancelar',
  tone = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    cancelBtnRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="confirm-backdrop"
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="confirm-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-desc"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm-head">
          <div className={`confirm-icon tone-${tone}`} aria-hidden="true">
            <AlertCircleIcon />
          </div>
          <div className="confirm-head-text">
            <h2 id="confirm-dialog-title" className="confirm-title">
              {title}
            </h2>
          </div>
          <button
            type="button"
            className="confirm-close-btn"
            onClick={onCancel}
            aria-label="Cerrar diálogo"
            title="Cerrar"
          >
            <XIcon />
          </button>
        </div>

        <p id="confirm-dialog-desc" className="confirm-desc">
          {description}
        </p>

        {detail && <div className="confirm-detail">{detail}</div>}

        <div className="confirm-actions">
          <button
            ref={cancelBtnRef}
            type="button"
            className="tool-btn"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`confirm-action-btn tone-${tone}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
