'use client';

import dynamic from 'next/dynamic';
import { FormEvent, useState } from 'react';
import { PROCESS_EXAMPLES } from '@/components/ProcessExamples';

const BpmnEditor = dynamic(() => import('@/components/BpmnEditor'), {
  ssr: false,
  loading: () => (
    <section className="canvas-panel">
      <div className="empty-state">
        <p>Cargando editor BPMN...</p>
      </div>
    </section>
  ),
});

interface GenerateMeta {
  provider: string;
  model: string;
  latencyMs: number;
}

interface GenerateResponse {
  bpmnXml?: string;
  assumptions?: string[];
  meta?: GenerateMeta;
  error?: string;
}

export default function HomePage() {
  const [description, setDescription] = useState('');
  const [bpmnXml, setBpmnXml] = useState<string | null>(null);
  const [assumptions, setAssumptions] = useState<string[]>([]);
  const [meta, setMeta] = useState<GenerateMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedLength = description.trim().length;
  const isValidLength = trimmedLength >= 10 && trimmedLength <= 4000;

  const generateDiagram = async () => {
    if (!isValidLength || loading) {
      if (!isValidLength) {
        setError('Ingresá una descripción de entre 10 y 4.000 caracteres.');
      }
      return;
    }

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
      setMeta(data.meta || null);
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

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>IMR BPMN Studio</h1>
          <span className="subtitle">
            Generación de diagramas de proceso BPMN 2.0 editables a partir de texto
          </span>
        </div>
      </header>

      <main className="app-main">
        <aside className="sidebar">
          <form onSubmit={handleSubmit}>
            <label htmlFor="process-description" className="field-label">
              <span>Descripción del proceso</span>
              <span className="char-count">{trimmedLength} / 4.000</span>
            </label>
            <textarea
              id="process-description"
              className="process-textarea"
              placeholder="Describí los pasos, decisiones y resultados del proceso de negocio..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={4000}
              disabled={loading}
            />

            <div className="examples-group" style={{ marginTop: 10, marginBottom: 12 }}>
              <span className="examples-label">Ejemplos precargados:</span>
              <div className="examples-list">
                {PROCESS_EXAMPLES.map((example) => (
                  <button
                    key={example.id}
                    type="button"
                    className="chip-btn"
                    disabled={loading}
                    onClick={() => {
                      setDescription(example.description);
                      setError(null);
                    }}
                  >
                    {example.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              className="primary-btn"
              disabled={loading || !isValidLength}
            >
              {loading ? 'Generando diagrama...' : 'Generar diagrama BPMN'}
            </button>
          </form>

          {loading && (
            <div className="status-box status-loading" role="status">
              Generando y validando sintaxis BPMN 2.0... Este proceso suele demorar entre 10 y 20
              segundos para priorizar calidad semántica.
            </div>
          )}

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
              <h3>Supuestos asumidos en la descripción</h3>
              <ul>
                {assumptions.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {meta && (
            <div className="meta-badge">
              Proveedor: <strong>{meta.provider}</strong> ({meta.model}) ·{' '}
              {(meta.latencyMs / 1000).toFixed(1)} s
            </div>
          )}
        </aside>

        <BpmnEditor xml={bpmnXml} />
      </main>
    </div>
  );
}
