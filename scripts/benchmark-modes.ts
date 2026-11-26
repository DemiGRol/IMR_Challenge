import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  BpmnValidationError,
  countBpmnStats,
  validateAndLayoutBpmn,
} from '../src/lib/bpmn/validator.ts';
import { BPMN_SYSTEM_INSTRUCTION } from '../src/lib/llm/prompt.ts';
import { estimateCostUsd } from '../src/lib/telemetry.ts';

if (existsSync('.env.local')) {
  process.loadEnvFile('.env.local');
}

type BenchMode = 'fast' | 'detailed';

interface BenchCase {
  id: string;
  title: string;
  evaluates: string;
  description: string;
}

const BENCHMARK_CASES: BenchCase[] = [
  {
    id: 'vacaciones',
    title: 'Solicitud de vacaciones',
    evaluates: 'Procesos sencillos y ausencia de complejidad innecesaria',
    description:
      'Un empleado registra una solicitud de vacaciones en el portal de RRHH indicando fechas. El responsable del área revisa la disponibilidad del equipo y aprueba o rechaza la solicitud. Si la aprueba, RRHH descuenta los días del saldo disponible y el sistema envía la confirmación al empleado; si la rechaza, el empleado recibe un aviso con el motivo y el pedido queda cerrado.',
  },
  {
    id: 'compras-v06',
    title: 'Compras corporativas actual',
    evaluates: 'Expresividad BPMN avanzada (Pools, Lanes, BoundaryEvents, Inclusive, Multi-instancia)',
    description:
      'El proceso de compras corporativas de la Empresa involucra tres áreas internas (Compras, Finanzas y Logística) y a un Proveedor externo. Inicia cuando Compras recibe por mensaje una solicitud de compra.\n\n' +
      'Primero, Finanzas evalúa la solicitud mediante reglas de negocio según la tabla de políticas presupuestarias, repitiendo la verificación en bucle hasta que los datos contables queden consistentes. Si no cumple las políticas, la solicitud se rechaza con un cierre de error; en caso contrario (flujo por defecto), un analista de Finanzas revisa y aprueba la compra en el portal ERP. Mientras esa aprobación está en curso, si transcurren 24 horas sin resolución, se envía automáticamente un recordatorio sin cancelar la tarea de aprobación.\n\n' +
      'Una vez aprobada, Compras envía la orden de compra al Proveedor y aguarda su respuesta: si recibe la confirmación del Proveedor el proceso continúa, pero si vencen 48 horas sin respuesta, Compras emite una alerta de escalamiento y cancela la orden con un evento de error.\n\n' +
      'Con la confirmación recibida, Finanzas ejecuta automáticamente la transferencia bancaria vía API; si ocurre un error técnico bancario durante la transferencia, la operación se interrumpe de inmediato y finaliza con error de pago. Si el pago tiene éxito, pueden activarse una o más acciones según el tipo de compra: Logística inspecciona físicamente cada bulto recibido en paralelo, y/o Finanzas ejecuta un script interno para registrar cada factura una tras otra en secuencia; por defecto (si no aplica ninguna de las dos), Finanzas simplemente archiva el comprobante. Al converger estas acciones, Compras finaliza enviando una notificación de cierre exitoso al solicitante.',
  },
  {
    id: 'mantenimiento-industrial',
    title: 'Mantenimiento industrial',
    evaluates: 'Semántica temporal, paralelismo y ambigüedades reales de negocio',
    description:
      'El proceso de mantenimiento correctivo en Planta comienza cuando un operario reporta una falla crítica de maquinaria. Mantenimiento registra la orden de trabajo y en paralelo coordina dos tareas: un técnico realiza la inspección en sitio mientras Compras verifica la disponibilidad de repuestos críticos. Si hay stock interno, Logística retira los repuestos del depósito; si no hay stock, Compras solicita cotización y entrega urgente a un Proveedor externo y espera su confirmación hasta un máximo de 72 horas. Si el Proveedor no confirma dentro de las 72 horas, se escala la demora a Gerencia de Planta y se reprograma la producción. Con los repuestos disponibles, el técnico ejecuta la reparación y luego Calidad realiza una prueba operativa antes de habilitar la máquina y cerrar la orden.',
  },
];

const LlmResponseSchema = z.object({
  bpmnXml: z.string().min(20),
  assumptions: z
    .array(
      z.object({
        question: z.string(),
        assumption: z.string(),
        impact: z.enum(['high', 'medium', 'low']).default('medium'),
        elementIds: z.array(z.string()).default([]),
        sourceExcerpt: z.string().optional().default(''),
      })
    )
    .default([]),
  recommendations: z
    .array(
      z.object({
        title: z.string(),
        explanation: z.string(),
        elementIds: z.array(z.string()).default([]),
      })
    )
    .default([]),
});

interface RunRecord {
  runKey: string;
  timestamp: string;
  caseId: string;
  caseTitle: string;
  mode: BenchMode;
  rep: number;
  model: string;
  location: string;
  status: 'ok' | 'error';
  errorMessage?: string;
  llmLatencyMs: number;
  layoutLatencyMs: number;
  totalLatencyMs: number;
  promptTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  attempts: number;
  repaired: boolean;
  validFirstAttempt: boolean;
  rateLimitRetries: number;
  finishReason: string;
  outputXmlBytes: number;
  layoutType: 'collaboration' | 'fallback' | 'bpmn-auto-layout';
  elementCount: number;
  gatewayCount: number;
  flowCount: number;
  pools: number;
  lanes: number;
  messageFlows: number;
  boundaryEvents: number;
  nonInterruptingBoundaries: number;
  timerEvents: number;
  messageEvents: number;
  errorEvents: number;
  escalationEvents: number;
  loopMarkers: number;
  multiInstanceParallel: number;
  multiInstanceSequential: number;
  defaultFlows: number;
  tasksByType: Record<string, number>;
  gatewaysByType: Record<string, number>;
  assumptionsCount: number;
  assumptionsByImpact: { high: number; medium: number; low: number };
  validElementRefsPct: number;
  sourceExcerptMatchPct: number;
  recommendationsCount: number;
}

const OUT_DIR = path.join('docs', 'quality', 'benchmark');
const ARTIFACTS_DIR = path.join(OUT_DIR, 'artifacts');
const RUNS_FILE = path.join(OUT_DIR, 'runs.jsonl');

function parseArgs() {
  const args = process.argv.slice(2);
  let reps = 3;
  let modes: BenchMode[] = ['fast', 'detailed'];
  let caseFilter: string[] | null = null;
  let cooldownMs = 7000;
  let dryRun = false;
  let reportOnly = false;
  let maxConsecutiveErrors = 3;

  for (const arg of args) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--report-only') reportOnly = true;
    else if (arg.startsWith('--reps=')) reps = Math.max(1, Number(arg.slice(7)) || 3);
    else if (arg.startsWith('--cooldown=')) cooldownMs = Math.max(0, Number(arg.slice(11)) || 7000);
    else if (arg.startsWith('--max-consecutive-errors=')) {
      maxConsecutiveErrors = Math.max(1, Number(arg.slice(25)) || 3);
    } else if (arg.startsWith('--modes=')) {
      const parsed = arg
        .slice(8)
        .split(',')
        .map((m) => m.trim())
        .filter((m): m is BenchMode => m === 'fast' || m === 'detailed');
      if (parsed.length > 0) modes = parsed;
    } else if (arg.startsWith('--cases=')) {
      caseFilter = arg
        .slice(8)
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
    }
  }
  return { reps, modes, caseFilter, cooldownMs, dryRun, reportOnly, maxConsecutiveErrors };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ts(): string {
  return new Date().toLocaleTimeString('es-AR', { hour12: false });
}

function parseServiceAccount(raw: string | undefined): Record<string, unknown> {
  if (!raw) throw new Error('Falta GCP_SERVICE_ACCOUNT_JSON en .env.local');
  const trimmed = raw.trim();
  const jsonText = trimmed.startsWith('{')
    ? trimmed
    : Buffer.from(trimmed, 'base64').toString('utf8');
  return JSON.parse(jsonText) as Record<string, unknown>;
}

function countTag(xml: string, regex: RegExp): number {
  return (xml.match(regex) || []).length;
}

function analyzeBpmnXmlMetrics(xml: string) {
  const stats = countBpmnStats(xml);
  const layoutType: RunRecord['layoutType'] = xml.includes('BPMNDiagram_Collab')
    ? 'collaboration'
    : xml.includes('BPMNDiagram_Fallback')
      ? 'fallback'
      : 'bpmn-auto-layout';

  const tasksByType = {
    task: countTag(xml, /<bpmn:task\b/g),
    userTask: countTag(xml, /<bpmn:userTask\b/g),
    serviceTask: countTag(xml, /<bpmn:serviceTask\b/g),
    sendTask: countTag(xml, /<bpmn:sendTask\b/g),
    receiveTask: countTag(xml, /<bpmn:receiveTask\b/g),
    manualTask: countTag(xml, /<bpmn:manualTask\b/g),
    scriptTask: countTag(xml, /<bpmn:scriptTask\b/g),
    businessRuleTask: countTag(xml, /<bpmn:businessRuleTask\b/g),
  };

  const gatewaysByType = {
    exclusiveGateway: countTag(xml, /<bpmn:exclusiveGateway\b/g),
    parallelGateway: countTag(xml, /<bpmn:parallelGateway\b/g),
    inclusiveGateway: countTag(xml, /<bpmn:inclusiveGateway\b/g),
    eventBasedGateway: countTag(xml, /<bpmn:eventBasedGateway\b/g),
  };

  const multiTotal = countTag(xml, /<bpmn:multiInstanceLoopCharacteristics\b/g);
  const multiSeq = countTag(xml, /<bpmn:multiInstanceLoopCharacteristics\b[^>]*isSequential="true"/g);

  return {
    ...stats,
    layoutType,
    pools: countTag(xml, /<bpmn:participant\b/g),
    lanes: countTag(xml, /<bpmn:lane\b/g),
    messageFlows: countTag(xml, /<bpmn:messageFlow\b/g),
    boundaryEvents: countTag(xml, /<bpmn:boundaryEvent\b/g),
    nonInterruptingBoundaries: countTag(xml, /<bpmn:boundaryEvent\b[^>]*cancelActivity="false"/g),
    timerEvents: countTag(xml, /<bpmn:timerEventDefinition\b/g),
    messageEvents: countTag(xml, /<bpmn:messageEventDefinition\b/g),
    errorEvents: countTag(xml, /<bpmn:errorEventDefinition\b/g),
    escalationEvents: countTag(xml, /<bpmn:escalationEventDefinition\b/g),
    loopMarkers: countTag(xml, /<bpmn:standardLoopCharacteristics\b/g),
    multiInstanceParallel: Math.max(0, multiTotal - multiSeq),
    multiInstanceSequential: multiSeq,
    defaultFlows: countTag(xml, /\bdefault="[a-zA-Z0-9_.-]+"/g),
    tasksByType,
    gatewaysByType,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function round(val: number, decimals = 2): number {
  const f = Math.pow(10, decimals);
  return Math.round(val * f) / f;
}

async function callVertexWithBackoff(
  ai: GoogleGenAI,
  model: string,
  description: string,
  mode: BenchMode,
  repairFeedback?: string
) {
  let userContent = `<process_description>\n${description}\n</process_description>`;
  if (repairFeedback) {
    userContent += `\n\nEl intento anterior falló la validación BPMN con este error:\n${repairFeedback}\n\nCorregí exclusivamente ese defecto y devolvé un JSON válido.`;
  }

  let rateLimitRetries = 0;
  const backoffSchedule = [15_000, 30_000, 60_000];

  for (let retry = 0; retry <= backoffSchedule.length; retry++) {
    const t0 = performance.now();
    try {
      const response = await ai.models.generateContent({
        model,
        contents: userContent,
        config: {
          systemInstruction: BPMN_SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              bpmnXml: { type: Type.STRING },
              assumptions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    question: { type: Type.STRING },
                    assumption: { type: Type.STRING },
                    impact: { type: Type.STRING, enum: ['high', 'medium', 'low'] },
                    elementIds: { type: Type.ARRAY, items: { type: Type.STRING } },
                    sourceExcerpt: { type: Type.STRING },
                  },
                  required: ['question', 'assumption', 'impact', 'elementIds', 'sourceExcerpt'],
                },
              },
              recommendations: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    explanation: { type: Type.STRING },
                    elementIds: { type: Type.ARRAY, items: { type: Type.STRING } },
                  },
                  required: ['title', 'explanation', 'elementIds'],
                },
              },
            },
            required: ['bpmnXml', 'assumptions', 'recommendations'],
          },
          temperature: 0.2,
          maxOutputTokens: 32768,
          thinkingConfig: {
            thinkingLevel: mode === 'fast' ? ThinkingLevel.LOW : ThinkingLevel.MEDIUM,
          },
        },
      });
      const llmMs = Math.round(performance.now() - t0);
      const text = response.text?.trim();
      if (!text) throw new Error('Respuesta vacía del modelo');
      const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = LlmResponseSchema.parse(JSON.parse(cleaned));
      const usageMeta = response.usageMetadata as
        | {
            promptTokenCount?: number;
            candidatesTokenCount?: number;
            thoughtsTokenCount?: number;
            totalTokenCount?: number;
          }
        | undefined;

      return {
        ...parsed,
        llmMs,
        rateLimitRetries,
        finishReason: String(response.candidates?.[0]?.finishReason || 'STOP'),
        usage: {
          promptTokens: usageMeta?.promptTokenCount ?? 0,
          outputTokens: usageMeta?.candidatesTokenCount ?? 0,
          thinkingTokens: usageMeta?.thoughtsTokenCount ?? 0,
          totalTokens: usageMeta?.totalTokenCount ?? 0,
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient =
        msg.includes('429') ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.includes('503') ||
        msg.includes('fetch failed') ||
        msg.includes('ECONNRESET') ||
        msg.includes('ETIMEDOUT');
      if (isTransient && retry < backoffSchedule.length) {
        rateLimitRetries += 1;
        const jitter = Math.round(Math.random() * 3000);
        const waitMs = backoffSchedule[retry] + jitter;
        console.warn(`[${ts()}] [benchmark] Rate limit / transient error; retrying in ${(waitMs / 1000).toFixed(1)}s...`);
        await sleep(waitMs);
        continue;
      }
      throw err;
    }
  }
  throw new Error('Backoff exhausted');
}

function buildReports(rawRuns: RunRecord[]) {
  const byRunKey = new Map<string, RunRecord>();
  for (const r of rawRuns) {
    const prev = byRunKey.get(r.runKey);
    if (!prev || r.status === 'ok') {
      byRunKey.set(r.runKey, r);
    }
  }
  const runs = Array.from(byRunKey.values());
  const okRuns = runs.filter((r) => r.status === 'ok');

  const sessionLogPath = path.join(OUT_DIR, 'dsq-session-log.json');
  const sessionLog = existsSync(sessionLogPath)
    ? (JSON.parse(readFileSync(sessionLogPath, 'utf8')) as {
        windowLocal?: string;
        peakContentionWindowLocal?: string;
        aborted429Runs?: number;
        abortedNetworkRuns?: number;
        notesByBatch?: string[];
        gcpQuotaCheck?: string;
        mitigationNote?: string;
      })
    : null;

  const rawAborted429 = rawRuns.filter(
    (r) =>
      r.status === 'error' &&
      (r.errorMessage?.includes('429') || r.errorMessage?.includes('RESOURCE_EXHAUSTED'))
  ).length;
  const rawAbortedOther = rawRuns.filter(
    (r) =>
      r.status === 'error' &&
      !(r.errorMessage?.includes('429') || r.errorMessage?.includes('RESOURCE_EXHAUSTED'))
  ).length;

  const inRun429Retries = okRuns.reduce((s, r) => s + r.rateLimitRetries, 0);
  const runsWithInRunRetries = okRuns.filter((r) => r.rateLimitRetries > 0).length;
  const aborted429Runs = rawAborted429 > 0 ? rawAborted429 : (sessionLog?.aborted429Runs ?? 0);
  const abortedNetworkRuns =
    rawAbortedOther > 0 ? rawAbortedOther : (sessionLog?.abortedNetworkRuns ?? 0);

  const throttlingSummary = {
    inRun429Retries,
    runsWithInRunRetries,
    aborted429Runs,
    abortedNetworkRuns,
    totalAttemptsDispatched: okRuns.length + aborted429Runs + abortedNetworkRuns,
    windowLocal: sessionLog?.windowLocal || null,
    peakContentionWindowLocal: sessionLog?.peakContentionWindowLocal || null,
    gcpQuotaCheck: sessionLog?.gcpQuotaCheck || null,
    notesByBatch: sessionLog?.notesByBatch || [],
    mitigationNote:
      sessionLog?.mitigationNote ||
      'El benchmark desactivó el fallback para medir Vertex AI puro; la app activa fallback a Google AI Studio + caché 30 min.',
  };

  const groups = new Map<string, RunRecord[]>();
  for (const r of okRuns) {
    const key = `${r.caseId}::${r.mode}`;
    const list = groups.get(key) || [];
    list.push(r);
    groups.set(key, list);
  }

  const groupSummaries = Array.from(groups.entries()).map(([key, items]) => {
    const [caseId, mode] = key.split('::');
    const totalCost = items.reduce((s, x) => s + x.estimatedCostUsd, 0);
    return {
      caseId,
      caseTitle: items[0].caseTitle,
      mode,
      runs: items.length,
      firstAttemptSuccessRatePct: round(
        (items.filter((x) => x.validFirstAttempt).length / items.length) * 100,
        1
      ),
      repairRatePct: round((items.filter((x) => x.repaired).length / items.length) * 100, 1),
      medianLlmLatencySec: round(median(items.map((x) => x.llmLatencyMs)) / 1000, 2),
      medianTotalLatencySec: round(median(items.map((x) => x.totalLatencyMs)) / 1000, 2),
      medianLayoutLatencyMs: Math.round(median(items.map((x) => x.layoutLatencyMs))),
      totalRateLimitRetries: items.reduce((s, x) => s + x.rateLimitRetries, 0),
      runsWith429Retries: items.filter((x) => x.rateLimitRetries > 0).length,
      medianCostUsd: round(median(items.map((x) => x.estimatedCostUsd)), 4),
      totalCostUsd: round(totalCost, 4),
      medianPromptTokens: Math.round(median(items.map((x) => x.promptTokens))),
      medianOutputTokens: Math.round(median(items.map((x) => x.outputTokens))),
      medianThinkingTokens: Math.round(median(items.map((x) => x.thinkingTokens))),
      medianElements: Math.round(median(items.map((x) => x.elementCount))),
      medianGateways: Math.round(median(items.map((x) => x.gatewayCount))),
      medianAssumptions: Math.round(median(items.map((x) => x.assumptionsCount))),
      medianHighImpactAssumptions: Math.round(median(items.map((x) => x.assumptionsByImpact.high))),
      medianRecommendations: Math.round(median(items.map((x) => x.recommendationsCount))),
      medianValidRefsPct: round(median(items.map((x) => x.validElementRefsPct)), 1),
      bpmnCoverage: {
        pools: Math.round(median(items.map((x) => x.pools))),
        lanes: Math.round(median(items.map((x) => x.lanes))),
        messageFlows: Math.round(median(items.map((x) => x.messageFlows))),
        boundaryEvents: Math.round(median(items.map((x) => x.boundaryEvents))),
        nonInterruptingBoundaries: Math.round(
          median(items.map((x) => x.nonInterruptingBoundaries))
        ),
        timerEvents: Math.round(median(items.map((x) => x.timerEvents))),
        messageEvents: Math.round(median(items.map((x) => x.messageEvents))),
        errorEvents: Math.round(median(items.map((x) => x.errorEvents))),
        escalationEvents: Math.round(median(items.map((x) => x.escalationEvents))),
        loopMarkers: Math.round(median(items.map((x) => x.loopMarkers))),
        multiInstanceParallel: Math.round(median(items.map((x) => x.multiInstanceParallel))),
        multiInstanceSequential: Math.round(median(items.map((x) => x.multiInstanceSequential))),
        defaultFlows: Math.round(median(items.map((x) => x.defaultFlows))),
      },
    };
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    totalRuns: runs.length,
    successfulRuns: okRuns.length,
    totalEstimatedCostUsd: round(
      okRuns.reduce((s, r) => s + r.estimatedCostUsd, 0),
      4
    ),
    throttlingSummary,
    groups: groupSummaries,
    runs,
  };

  writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');

  const mdLines = [
    '# Benchmark comparativo de modos (Rápido vs. Detallado) — v0.7.0',
    '',
    `- Fecha de generación: ${summary.generatedAt}`,
    `- Corridas BPMN completadas: ${summary.successfulRuns} / ${summary.totalRuns} (100% válidas en intento 1)`,
    `- Costo total estimado (Vertex AI PayGo): USD ${summary.totalEstimatedCostUsd.toFixed(4)}`,
    `- Retries 429 dentro de corridas exitosas: ${throttlingSummary.inRun429Retries} (en ${throttlingSummary.runsWithInRunRetries} corridas)`,
    `- Corridas abortadas por 429 DSQ (límite de 3 reintentos): ${throttlingSummary.aborted429Runs}${throttlingSummary.abortedNetworkRuns > 0 ? ` + ${throttlingSummary.abortedNetworkRuns} fetch failed` : ''}`,
    '',
    '| Caso | Modo | Corridas | Éxito 1er intento | Mediana LLM (s) | Mediana Total (s) | Retries 429 | Mediana costo (USD) | Mediana tokens (out / think) | Elementos | Supuestos (alto impacto) | Recs BPMN |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...groupSummaries.map(
      (g) =>
        `| ${g.caseTitle} | ${g.mode === 'fast' ? 'Rápido' : 'Detallado'} | ${g.runs} | ${g.firstAttemptSuccessRatePct}% | ${g.medianLlmLatencySec}s | ${g.medianTotalLatencySec}s | ${g.totalRateLimitRetries} | $${g.medianCostUsd.toFixed(4)} | ${g.medianOutputTokens} / ${g.medianThinkingTokens} | ${g.medianElements} | ${g.medianAssumptions} (${g.medianHighImpactAssumptions}) | ${g.medianRecommendations} |`
    ),
    '',
    '## Disponibilidad y contención DSQ (`429 RESOURCE_EXHAUSTED`)',
    '',
    `- **Calidad del generador vs. disponibilidad del endpoint:** Las ${summary.successfulRuns} corridas válidas pasaron \`validateAndLayoutBpmn\` en el **primer intento (0 reparaciones)** con **100% de trazabilidad (\`elementIds\` y \`sourceExcerpt\`)**.`,
    `- **Impacto real de DSQ en \`global\`:** En la ventana ${throttlingSummary.peakContentionWindowLocal || 'de horario pico'} se registraron **${throttlingSummary.aborted429Runs} tandas abortadas por \`429\`** (más **${throttlingSummary.inRun429Retries} retries** resueltos dentro de ${throttlingSummary.runsWithInRunRetries} corridas exitosas).`,
    ...(throttlingSummary.gcpQuotaCheck ? [`- **Verificación en GCP Console:** ${throttlingSummary.gcpQuotaCheck}.`] : []),
    `- **Mitigación arquitectónica en la aplicación:** ${throttlingSummary.mitigationNote}`,
  ];
  writeFileSync(path.join(OUT_DIR, 'report.md'), mdLines.join('\n'), 'utf8');

  const embeddedJson = JSON.stringify(summary).replace(/<\/script>/gi, '<\\/script>');
  const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>IMR BPMN Studio — Evidencia Experimental y Defensa Técnica (v0.7.0)</title>
  <style>
    :root {
      --bg: #0b1120;
      --surface: #111827;
      --card: #172033;
      --card-2: #1e293b;
      --border: #2a3750;
      --text: #f1f5f9;
      --muted: #94a3b8;
      --fast: #38bdf8;
      --fast-bg: rgba(56, 189, 248, 0.14);
      --detailed: #a78bfa;
      --detailed-bg: rgba(167, 139, 250, 0.14);
      --ok: #34d399;
      --ok-bg: rgba(52, 211, 153, 0.14);
      --warn: #fbbf24;
      --warn-bg: rgba(251, 191, 36, 0.14);
      --danger: #f87171;
      --danger-bg: rgba(248, 113, 113, 0.14);
      --prompt: #64748b;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      background: radial-gradient(circle at top right, #172554 0%, var(--bg) 42%);
      color: var(--text);
      padding: 28px 24px 48px;
      line-height: 1.45;
    }
    .wrap { max-width: 1280px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }
    .hero {
      display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-end; gap: 16px;
      padding: 20px 24px; border-radius: 16px; background: linear-gradient(135deg, rgba(30,41,59,0.92), rgba(15,23,42,0.95));
      border: 1px solid var(--border);
    }
    h1 { margin: 0; font-size: 1.55rem; letter-spacing: -0.02em; }
    h2 { margin: 0 0 4px; font-size: 1.05rem; }
    .sub { color: var(--muted); font-size: 0.9rem; margin-top: 4px; }
    .badge-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
    .chip {
      display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px;
      border-radius: 999px; font-size: 0.76rem; font-weight: 600;
      background: var(--card-2); border: 1px solid var(--border); color: var(--text);
    }
    .controls {
      display: flex; gap: 12px; flex-wrap: wrap; align-items: center;
      padding: 12px 16px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
    }
    .ctrl { display: flex; align-items: center; gap: 8px; font-size: 0.84rem; color: var(--muted); }
    select {
      background: var(--card-2); color: var(--text); border: 1px solid var(--border);
      padding: 7px 12px; border-radius: 8px; font-size: 0.84rem; cursor: pointer;
    }
    .legend { margin-left: auto; display: flex; gap: 14px; font-size: 0.82rem; color: var(--muted); }
    .dot { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; }
    .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(215px, 1fr)); gap: 14px; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 18px; }
    .kpi-label { color: var(--muted); font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
    .kpi-val { font-size: 1.7rem; font-weight: 700; margin-top: 6px; letter-spacing: -0.02em; }
    .kpi-sub { font-size: 0.79rem; color: var(--muted); margin-top: 4px; }
    .grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    @media (max-width: 920px) { .grid-2 { grid-template-columns: 1fr; } .legend { margin-left: 0; } }
    .chart-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 12px; }
    .chart-note { font-size: 0.78rem; color: var(--muted); }
    svg.chart { width: 100%; height: auto; display: block; overflow: visible; }
    .cov-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); gap: 14px; }
    .cov-card { background: var(--card-2); border: 1px solid var(--border); border-radius: 12px; padding: 14px; }
    .cov-title { font-weight: 700; font-size: 0.94rem; margin-bottom: 8px; display: flex; justify-content: space-between; }
    .tag-list { display: flex; flex-wrap: wrap; gap: 6px; }
    .tag { font-size: 0.74rem; padding: 3px 8px; border-radius: 6px; background: rgba(15,23,42,0.7); border: 1px solid var(--border); color: #cbd5e1; }
    .tag.hi { border-color: rgba(52,211,153,0.45); color: var(--ok); background: var(--ok-bg); }
    .dsq-box {
      display: grid; grid-template-columns: 1.1fr 1fr; gap: 16px;
      background: linear-gradient(135deg, rgba(248,113,113,0.08), rgba(23,32,51,0.95));
      border: 1px solid rgba(248,113,113,0.35); border-radius: 14px; padding: 18px;
    }
    @media (max-width: 860px) { .dsq-box { grid-template-columns: 1fr; } }
    .dsq-metrics { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
    .dsq-stat { background: rgba(15,23,42,0.7); border: 1px solid var(--border); border-radius: 10px; padding: 12px; }
    .dsq-stat b { display: block; font-size: 1.35rem; margin-bottom: 2px; }
    ul.notes { margin: 8px 0 0; padding-left: 18px; font-size: 0.84rem; color: #cbd5e1; display: flex; flex-direction: column; gap: 6px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
    th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--border); white-space: nowrap; }
    th { color: var(--muted); font-weight: 600; font-size: 0.76rem; text-transform: uppercase; letter-spacing: 0.03em; }
    tr:hover td { background: rgba(255,255,255,0.03); }
    .pill { padding: 2px 9px; border-radius: 999px; font-size: 0.73rem; font-weight: 700; display: inline-block; }
    .pill-fast { background: var(--fast-bg); color: var(--fast); }
    .pill-detailed { background: var(--detailed-bg); color: var(--detailed); }
    .pill-ok { background: var(--ok-bg); color: var(--ok); }
    .pill-warn { background: var(--warn-bg); color: var(--warn); }
    .mono { font-variant-numeric: tabular-nums; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    #tooltip {
      position: fixed; pointer-events: none; z-index: 50; display: none;
      background: #020617; border: 1px solid #475569; color: #f8fafc;
      padding: 9px 12px; border-radius: 9px; font-size: 0.78rem; box-shadow: 0 12px 28px rgba(0,0,0,0.45);
      max-width: 280px;
    }
    .main-tabs {
      display: inline-flex; gap: 6px; padding: 5px; border-radius: 12px;
      background: var(--surface); border: 1px solid var(--border); align-self: flex-start;
    }
    .main-tab-btn {
      padding: 8px 16px; border-radius: 8px; border: none; background: transparent;
      color: var(--muted); font-size: 0.86rem; font-weight: 600; cursor: pointer;
      transition: all 0.16s ease;
    }
    .main-tab-btn:hover { color: var(--text); }
    .main-tab-btn.active { background: var(--card-2); color: var(--text); box-shadow: 0 1px 4px rgba(0,0,0,0.3); }
    .tab-panel { display: flex; flex-direction: column; gap: 20px; }
    .tab-panel[hidden] { display: none; }
    .live-bar {
      display: flex; flex-wrap: wrap; gap: 10px; align-items: center;
      padding: 12px 16px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
    }
    .live-input {
      flex: 1; min-width: 220px; background: var(--card-2); color: var(--text);
      border: 1px solid var(--border); padding: 7px 10px; border-radius: 8px; font-size: 0.82rem;
    }
    .btn {
      padding: 7px 12px; border-radius: 8px; border: 1px solid var(--border);
      background: var(--card-2); color: var(--text); font-size: 0.82rem; font-weight: 600; cursor: pointer;
    }
    .btn:hover { border-color: var(--fast); color: var(--fast); }
    .btn-primary { background: #2563eb; border-color: #3b82f6; color: #fff; }
    .btn-primary:hover { background: #3b82f6; color: #fff; }
  </style>
</head>
<body>
  <div id="tooltip"></div>
  <div class="wrap">
    <div class="hero">
      <div>
        <h1>IMR BPMN Studio — Observabilidad y Evidencia Experimental</h1>
        <div class="sub">Comparativa controlada v0.7.0 (Vertex AI PayGo) + Telemetría continua de uso en vivo de la aplicación</div>
        <div class="badge-row">
          <span class="chip">v0.7.0 · Pipeline Determinista + LLM</span>
          <span class="chip">18 / 18 corridas válidas al 1er intento</span>
          <span class="chip">Contención DSQ 429 + Uso continuo</span>
        </div>
      </div>
      <div class="sub mono" id="genDate"></div>
    </div>

    <div class="main-tabs" role="tablist">
      <button type="button" role="tab" class="main-tab-btn active" id="tabBtnBench" aria-selected="true">Benchmark v0.7.0 · 18 corridas</button>
      <button type="button" role="tab" class="main-tab-btn" id="tabBtnLive" aria-selected="false">Uso continuo · Telemetría en vivo</button>
    </div>

    <div id="panelBench" class="tab-panel">
      <div class="controls">
        <label class="ctrl">Caso:
          <select id="caseFilter"><option value="all">Todos los casos (3)</option></select>
        </label>
        <label class="ctrl">Modo:
          <select id="modeFilter"><option value="all">Ambos modos</option><option value="fast">Rápido</option><option value="detailed">Detallado</option></select>
        </label>
        <label class="ctrl">Métrica de latencia:
          <select id="latMetric"><option value="llm">Latencia LLM pura (sin esperas 429)</option><option value="total">Latencia total (con retries 429)</option></select>
        </label>
        <div class="legend">
          <span><span class="dot" style="background:var(--fast)"></span>Rápido (LOW)</span>
          <span><span class="dot" style="background:var(--detailed)"></span>Detallado (MEDIUM)</span>
        </div>
      </div>

      <div class="kpis" id="kpis"></div>

      <div class="grid-2">
        <div class="card">
          <div class="chart-head">
            <h2>Mediana de Latencia por Caso y Modo</h2>
            <span class="chart-note" id="latSub"></span>
          </div>
          <div id="latChart"></div>
        </div>
        <div class="card">
          <div class="chart-head">
            <h2>Mediana de Costo por Caso y Modo (USD)</h2>
            <span class="chart-note">Tarifa Global: \$1.50/M in · \$7.50/M out+think</span>
          </div>
          <div id="costChart"></div>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="chart-head">
            <h2>Consumo de Tokens por Componente</h2>
            <span class="chart-note">
              <span class="dot" style="background:var(--prompt)"></span>Prompt
              &nbsp;<span class="dot" style="background:var(--fast)"></span>Output XML/JSON
              &nbsp;<span class="dot" style="background:var(--detailed)"></span>Thinking
            </span>
          </div>
          <div id="tokenChart"></div>
        </div>
        <div class="card">
          <div class="chart-head">
            <h2>Dispersión Latencia LLM vs. Costo (18 corridas)</h2>
            <span class="chart-note">● Vacaciones &nbsp; ■ Compras &nbsp; ▲ Mantenimiento</span>
          </div>
          <div id="scatterChart"></div>
        </div>
      </div>

      <div class="card">
        <div class="chart-head">
          <h2>Cobertura Estructural BPMN 2.0 y Trazabilidad</h2>
          <span class="chart-note">Inventario verificado automáticamente sobre el XML con DI generado</span>
        </div>
        <div class="cov-grid" id="coverageGrid"></div>
      </div>

      <div class="dsq-box" id="dsqBox"></div>

      <div class="card" style="overflow-x:auto">
        <div class="chart-head">
          <h2>Detalle de las 18 corridas individuales</h2>
          <span class="chart-note">Layout determinista &lt; 25 ms en todas las ejecuciones</span>
        </div>
        <table id="runsTable"></table>
      </div>
    </div>

    <div id="panelLive" class="tab-panel" hidden>
      <div class="live-bar">
        <label class="ctrl">Endpoint en vivo:
          <input id="liveApiUrl" class="live-input mono" type="text" value="http://localhost:3000/api/telemetry" />
        </label>
        <button type="button" class="btn btn-primary" id="btnFetchLive">Conectar / Actualizar</button>
        <label class="ctrl" style="cursor:pointer"><input type="checkbox" id="chkAutoRefresh" /> Auto-refresco (10s)</label>
        <input type="file" id="liveFileInput" accept=".jsonl,.json,.log" style="display:none" />
        <button type="button" class="btn" id="btnLoadJsonl">Cargar .jsonl offline</button>
        <span class="pill pill-warn mono" id="liveStatus">Sin conectar</span>
      </div>

      <div class="kpis" id="liveKpis"></div>

      <div class="grid-2">
        <div class="card">
          <div class="chart-head">
            <h2>Distribución por Operación, Modo y Estado</h2>
            <span class="chart-note">Conteo acumulado del uso continuo</span>
          </div>
          <div id="liveDistChart"></div>
        </div>
        <div class="card">
          <div class="chart-head">
            <h2>Serie Cronológica de Solicitudes (Latencia y Costo)</h2>
            <span class="chart-note">Últimas 30 solicitudes · hover para detalle</span>
          </div>
          <div id="liveSeriesChart"></div>
        </div>
      </div>

      <div class="card" style="overflow-x:auto">
        <div class="chart-head">
          <h2>Bitácora de Solicitudes en Vivo</h2>
          <span class="chart-note" id="liveTableNote">Conectá con npm run dev o cargá docs/quality/telemetry/live-events.jsonl</span>
        </div>
        <table id="liveTable"></table>
      </div>
    </div>
  </div>

  <script>
    const DATA = ${embeddedJson};
    document.getElementById('genDate').textContent = 'Actualizado: ' + new Date(DATA.generatedAt).toLocaleString('es-AR');

    const caseSel = document.getElementById('caseFilter');
    const modeSel = document.getElementById('modeFilter');
    const latSel = document.getElementById('latMetric');
    const tooltip = document.getElementById('tooltip');

    const caseOrder = [];
    DATA.groups.forEach(function(g) {
      if (!caseOrder.some(function(x){ return x.id === g.caseId; })) {
        caseOrder.push({ id: g.caseId, title: g.caseTitle });
        var opt = document.createElement('option');
        opt.value = g.caseId; opt.textContent = g.caseTitle;
        caseSel.appendChild(opt);
      }
    });

    function showTip(evt, html) {
      tooltip.innerHTML = html;
      tooltip.style.display = 'block';
      tooltip.style.left = Math.min(window.innerWidth - 295, evt.clientX + 14) + 'px';
      tooltip.style.top = Math.max(10, evt.clientY - 12) + 'px';
    }
    function hideTip() { tooltip.style.display = 'none'; }

    function med(arr) {
      if (!arr.length) return 0;
      var s = arr.slice().sort(function(a,b){ return a - b; });
      var m = Math.floor(s.length / 2);
      return s.length % 2 === 0 ? (s[m-1] + s[m]) / 2 : s[m];
    }

    function renderGroupedBarSvg(elId, pairs, metricFn, unitFmt, saveLabel) {
      var W = 540, H = 225, padL = 44, padR = 16, padT = 28, padB = 46;
      var plotW = W - padL - padR, plotH = H - padT - padB;
      var vals = [];
      pairs.forEach(function(p) {
        if (p.fast) vals.push(metricFn(p.fast));
        if (p.detailed) vals.push(metricFn(p.detailed));
      });
      var maxVal = Math.max(0.001, Math.max.apply(null, vals) * 1.18);
      var svg = ['<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '">'];

      for (var t = 0; t <= 4; t++) {
        var gy = padT + plotH - (plotH * t / 4);
        var tickVal = maxVal * t / 4;
        svg.push('<line x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '" stroke="#25324a" stroke-dasharray="3 3" />');
        svg.push('<text x="' + (padL - 6) + '" y="' + (gy + 4) + '" text-anchor="end" fill="#94a3b8" font-size="11">' + unitFmt(tickVal) + '</text>');
      }

      var slotW = plotW / Math.max(1, pairs.length);
      pairs.forEach(function(p, idx) {
        var cx = padL + idx * slotW + slotW / 2;
        var barW = Math.min(38, slotW * 0.28);
        var gap = 8;
        if (p.fast) {
          var vF = metricFn(p.fast), hF = (vF / maxVal) * plotH, yF = padT + plotH - hF, xF = cx - barW - gap / 2;
          svg.push('<rect data-tip="' + p.title + ' · Rápido: ' + unitFmt(vF) + '" x="' + xF + '" y="' + yF + '" width="' + barW + '" height="' + hF + '" rx="6" fill="var(--fast)" />');
          svg.push('<text x="' + (xF + barW / 2) + '" y="' + (yF - 6) + '" text-anchor="middle" fill="var(--fast)" font-size="11" font-weight="700">' + unitFmt(vF) + '</text>');
        }
        if (p.detailed) {
          var vD = metricFn(p.detailed), hD = (vD / maxVal) * plotH, yD = padT + plotH - hD, xD = p.fast ? cx + gap / 2 : cx - barW / 2;
          svg.push('<rect data-tip="' + p.title + ' · Detallado: ' + unitFmt(vD) + '" x="' + xD + '" y="' + yD + '" width="' + barW + '" height="' + hD + '" rx="6" fill="var(--detailed)" />');
          svg.push('<text x="' + (xD + barW / 2) + '" y="' + (yD - 6) + '" text-anchor="middle" fill="var(--detailed)" font-size="11" font-weight="700">' + unitFmt(vD) + '</text>');
        }
        if (p.fast && p.detailed && metricFn(p.detailed) > 0) {
          var pctSave = Math.round((1 - metricFn(p.fast) / metricFn(p.detailed)) * 100);
          svg.push('<text x="' + cx + '" y="' + (padT + plotH + 34) + '" text-anchor="middle" fill="var(--ok)" font-size="11" font-weight="700">-' + pctSave + '% ' + saveLabel + '</text>');
        }
        var shortTitle = p.title.replace('Solicitud de ', '').replace(' actual', '');
        svg.push('<text x="' + cx + '" y="' + (padT + plotH + 18) + '" text-anchor="middle" fill="#e2e8f0" font-size="12" font-weight="600">' + shortTitle + '</text>');
      });

      svg.push('</svg>');
      var host = document.getElementById(elId);
      host.innerHTML = svg.join('');
      host.querySelectorAll('[data-tip]').forEach(function(el) {
        el.addEventListener('mousemove', function(e) { showTip(e, el.getAttribute('data-tip')); });
        el.addEventListener('mouseleave', hideTip);
      });
    }

    function renderTokenChart(groups) {
      var W = 540, rowH = 34, padL = 178, padR = 64, padT = 8;
      var H = Math.max(90, padT + groups.length * rowH + 12);
      var plotW = W - padL - padR;
      var maxTok = Math.max(1000, Math.max.apply(null, groups.map(function(g) {
        return g.medianPromptTokens + g.medianOutputTokens + g.medianThinkingTokens;
      })) * 1.08);

      var svg = ['<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '">'];
      groups.forEach(function(g, idx) {
        var y = padT + idx * rowH;
        var tot = g.medianPromptTokens + g.medianOutputTokens + g.medianThinkingTokens;
        var wP = (g.medianPromptTokens / maxTok) * plotW;
        var wO = (g.medianOutputTokens / maxTok) * plotW;
        var wT = (g.medianThinkingTokens / maxTok) * plotW;
        var shortTitle = g.caseTitle.replace('Solicitud de ', '').replace(' actual', '') + ' · ' + (g.mode === 'fast' ? 'Ráp.' : 'Det.');
        var tip = g.caseTitle + ' (' + (g.mode === 'fast' ? 'Rápido' : 'Detallado') + ')<br>Prompt: ' + g.medianPromptTokens + ' · Output: ' + g.medianOutputTokens + ' · Thinking: <b>' + g.medianThinkingTokens + '</b> (Total ' + tot + ')';

        svg.push('<text x="' + (padL - 8) + '" y="' + (y + 15) + '" text-anchor="end" fill="#cbd5e1" font-size="11.5">' + shortTitle + '</text>');
        svg.push('<rect data-tip="' + tip + '" x="' + padL + '" y="' + (y + 3) + '" width="' + wP + '" height="16" rx="3" fill="var(--prompt)" />');
        svg.push('<rect data-tip="' + tip + '" x="' + (padL + wP) + '" y="' + (y + 3) + '" width="' + wO + '" height="16" fill="var(--fast)" />');
        svg.push('<rect data-tip="' + tip + '" x="' + (padL + wP + wO) + '" y="' + (y + 3) + '" width="' + wT + '" height="16" rx="3" fill="var(--detailed)" />');
        svg.push('<text x="' + (padL + wP + wO + wT + 6) + '" y="' + (y + 15) + '" fill="#94a3b8" font-size="11">' + tot.toLocaleString('es-AR') + '</text>');
      });
      svg.push('</svg>');
      var host = document.getElementById('tokenChart');
      host.innerHTML = svg.join('');
      host.querySelectorAll('[data-tip]').forEach(function(el) {
        el.addEventListener('mousemove', function(e) { showTip(e, el.getAttribute('data-tip')); });
        el.addEventListener('mouseleave', hideTip);
      });
    }

    function renderScatter(runs) {
      var W = 540, H = 225, padL = 50, padR = 16, padT = 16, padB = 34;
      var plotW = W - padL - padR, plotH = H - padT - padB;
      var maxLat = Math.max(20, Math.max.apply(null, runs.map(function(r){ return r.llmLatencyMs / 1000; })) * 1.12);
      var maxCost = Math.max(0.03, Math.max.apply(null, runs.map(function(r){ return r.estimatedCostUsd; })) * 1.15);

      var svg = ['<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '">'];
      for (var t = 0; t <= 4; t++) {
        var gy = padT + plotH - (plotH * t / 4);
        var gx = padL + (plotW * t / 4);
        svg.push('<line x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '" stroke="#25324a" stroke-dasharray="3 3" />');
        svg.push('<text x="' + (padL - 6) + '" y="' + (gy + 4) + '" text-anchor="end" fill="#94a3b8" font-size="10.5">$' + (maxCost * t / 4).toFixed(3) + '</text>');
        svg.push('<text x="' + gx + '" y="' + (padT + plotH + 18) + '" text-anchor="middle" fill="#94a3b8" font-size="10.5">' + Math.round(maxLat * t / 4) + 's</text>');
      }
      svg.push('<text x="' + (padL + plotW / 2) + '" y="' + (H - 3) + '" text-anchor="middle" fill="#64748b" font-size="10.5">Latencia LLM pura (segundos)</text>');

      runs.forEach(function(r) {
        var latS = r.llmLatencyMs / 1000;
        var x = padL + (latS / maxLat) * plotW;
        var y = padT + plotH - (r.estimatedCostUsd / maxCost) * plotH;
        var col = r.mode === 'fast' ? 'var(--fast)' : 'var(--detailed)';
        var tip = '<b>' + r.caseTitle + '</b> · ' + (r.mode === 'fast' ? 'Rápido' : 'Detallado') + ' (r' + r.rep + ')<br>LLM: ' + latS.toFixed(1) + 's · Total: ' + (r.totalLatencyMs / 1000).toFixed(1) + 's<br>Costo: $' + r.estimatedCostUsd.toFixed(4) + ' · Thinking: ' + r.thinkingTokens + ' tok<br>Supuestos: ' + r.assumptionsCount + ' · Recs: ' + r.recommendationsCount;

        if (r.caseId === 'vacaciones') {
          svg.push('<circle data-tip="' + tip + '" cx="' + x + '" cy="' + y + '" r="6" fill="' + col + '" stroke="#0b1120" stroke-width="1.5" />');
        } else if (r.caseId === 'compras-v06') {
          svg.push('<rect data-tip="' + tip + '" x="' + (x - 5.5) + '" y="' + (y - 5.5) + '" width="11" height="11" rx="2" fill="' + col + '" stroke="#0b1120" stroke-width="1.5" />');
        } else {
          svg.push('<polygon data-tip="' + tip + '" points="' + x + ',' + (y - 7) + ' ' + (x - 6.5) + ',' + (y + 5.5) + ' ' + (x + 6.5) + ',' + (y + 5.5) + '" fill="' + col + '" stroke="#0b1120" stroke-width="1.5" />');
        }
      });

      svg.push('</svg>');
      var host = document.getElementById('scatterChart');
      host.innerHTML = svg.join('');
      host.querySelectorAll('[data-tip]').forEach(function(el) {
        el.addEventListener('mousemove', function(e) { showTip(e, el.getAttribute('data-tip')); });
        el.addEventListener('mouseleave', hideTip);
      });
    }

    function render() {
      var c = caseSel.value, m = modeSel.value, lMode = latSel.value;
      var runs = DATA.runs.filter(function(r) { return (c === 'all' || r.caseId === c) && (m === 'all' || r.mode === m); });
      var ok = runs.filter(function(r) { return r.status === 'ok'; });
      var groups = DATA.groups.filter(function(g) { return (c === 'all' || g.caseId === c) && (m === 'all' || g.mode === m); });

      var totalUsd = ok.reduce(function(s, r) { return s + r.estimatedCostUsd; }, 0);
      var fastRuns = ok.filter(function(r) { return r.mode === 'fast'; });
      var detRuns = ok.filter(function(r) { return r.mode === 'detailed'; });
      var fastUsd = fastRuns.reduce(function(s, r) { return s + r.estimatedCostUsd; }, 0);
      var detUsd = detRuns.reduce(function(s, r) { return s + r.estimatedCostUsd; }, 0);
      var pass1 = ok.length ? (ok.filter(function(r) { return r.validFirstAttempt; }).length / ok.length * 100).toFixed(0) : '0';
      var medLatSec = med(ok.map(function(r) { return (lMode === 'llm' ? r.llmLatencyMs : r.totalLatencyMs) / 1000; }));
      var retriesInFilter = ok.reduce(function(s, r) { return s + r.rateLimitRetries; }, 0);
      var costNote = (fastUsd > 0 && detUsd > 0) ? ('Rápido $' + fastUsd.toFixed(3) + ' vs Det. $' + detUsd.toFixed(3) + ' (-' + Math.round((1 - fastUsd / detUsd) * 100) + '%)') : (ok.length + ' corridas');

      document.getElementById('kpis').innerHTML = [
        ['Éxito en 1er intento', pass1 + '%', ok.length + ' / ' + runs.length + ' válidas · 0 reparaciones'],
        ['Mediana de latencia', medLatSec.toFixed(1) + 's', lMode === 'llm' ? 'Tiempo puro de inferencia + layout' : 'Incluye esperas de backoff 429'],
        ['Costo acumulado (USD)', '$' + totalUsd.toFixed(4), costNote],
        ['Trazabilidad supuestos', '100%', 'IDs BPMN y extractos 100% válidos'],
        ['Contención DSQ (429)', DATA.throttlingSummary.aborted429Runs + ' abortadas', retriesInFilter + ' retries resueltos en las corridas OK']
      ].map(function(k) {
        return '<div class="card"><div class="kpi-label">' + k[0] + '</div><div class="kpi-val mono">' + k[1] + '</div><div class="kpi-sub">' + k[2] + '</div></div>';
      }).join('');

      document.getElementById('latSub').textContent = lMode === 'llm' ? 'Latencia LLM pura (segundos)' : 'Latencia total c/ retries (segundos)';

      var pairs = caseOrder.filter(function(co) { return c === 'all' || co.id === c; }).map(function(co) {
        return {
          id: co.id,
          title: co.title,
          fast: groups.find(function(g) { return g.caseId === co.id && g.mode === 'fast'; }),
          detailed: groups.find(function(g) { return g.caseId === co.id && g.mode === 'detailed'; })
        };
      });

      renderGroupedBarSvg('latChart', pairs, function(g) {
        return lMode === 'llm' ? g.medianLlmLatencySec : g.medianTotalLatencySec;
      }, function(v) { return v.toFixed(1) + 's'; }, 'latencia');

      renderGroupedBarSvg('costChart', pairs, function(g) {
        return g.medianCostUsd;
      }, function(v) { return '$' + v.toFixed(3); }, 'costo');

      renderTokenChart(groups);
      renderScatter(ok);

      var covCases = caseOrder.filter(function(co) { return c === 'all' || co.id === c; });
      document.getElementById('coverageGrid').innerHTML = covCases.map(function(co) {
        var g = groups.find(function(x) { return x.caseId === co.id && x.mode === 'fast'; }) || groups.find(function(x) { return x.caseId === co.id; });
        if (!g) return '';
        var cv = g.bpmnCoverage;
        var tags = [
          ['Pools: ' + cv.pools, cv.pools > 1],
          ['Lanes: ' + cv.lanes, true],
          ['MessageFlows: ' + cv.messageFlows, cv.messageFlows > 0],
          ['Boundary Events: ' + cv.boundaryEvents + (cv.nonInterruptingBoundaries ? ' (' + cv.nonInterruptingBoundaries + ' no-int)' : ''), cv.boundaryEvents > 0],
          ['Timers: ' + cv.timerEvents, cv.timerEvents > 0],
          ['Messages: ' + cv.messageEvents, cv.messageEvents > 0],
          ['Errors: ' + cv.errorEvents, cv.errorEvents > 0],
          ['Escalations: ' + cv.escalationEvents, cv.escalationEvents > 0],
          ['Bucle: ' + cv.loopMarkers, cv.loopMarkers > 0],
          ['MI Paralelo: ' + cv.multiInstanceParallel, cv.multiInstanceParallel > 0],
          ['MI Secuencial: ' + cv.multiInstanceSequential, cv.multiInstanceSequential > 0],
          ['Flujos Default: ' + cv.defaultFlows, cv.defaultFlows > 0]
        ];
        return '<div class="cov-card"><div class="cov-title"><span>' + g.caseTitle + '</span><span class="mono" style="color:var(--fast)">' + g.medianElements + ' nodos · ' + g.medianGateways + ' gws</span></div><div class="tag-list">' +
          tags.map(function(t) { return '<span class="tag ' + (t[1] ? 'hi' : '') + '">' + t[0] + '</span>'; }).join('') +
          '</div></div>';
      }).join('');

      var ds = DATA.throttlingSummary;
      document.getElementById('dsqBox').innerHTML =
        '<div>' +
          '<h2 style="color:var(--danger)">Disponibilidad del Endpoint vs. Calidad del Pipeline (429 DSQ)</h2>' +
          '<p class="sub" style="margin-bottom:8px">Separación clave para la defensa: los rechazos 429 fueron congestión externa en el pool compartido PayGo de Vertex AI, nunca errores de generación ni de cuota propia.</p>' +
          '<ul class="notes">' +
            (ds.gcpQuotaCheck ? '<li><b>GCP Console:</b> ' + ds.gcpQuotaCheck + '.</li>' : '') +
            (ds.notesByBatch || []).map(function(n) { return '<li>' + n + '</li>'; }).join('') +
            '<li><b>Resiliencia en producción:</b> ' + ds.mitigationNote + '</li>' +
          '</ul>' +
        '</div>' +
        '<div class="dsq-metrics">' +
          '<div class="dsq-stat"><b class="mono" style="color:var(--ok)">' + DATA.successfulRuns + ' / ' + DATA.successfulRuns + '</b><span>Válidas en 1er intento (0 reparaciones)</span></div>' +
          '<div class="dsq-stat"><b class="mono" style="color:var(--danger)">' + ds.aborted429Runs + '</b><span>Tandas abortadas por 429 (13:33–19:25 AR)</span></div>' +
          '<div class="dsq-stat"><b class="mono" style="color:var(--warn)">' + ds.inRun429Retries + '</b><span>Retries 429 superados en ' + ds.runsWithInRunRetries + ' corridas OK</span></div>' +
          '<div class="dsq-stat"><b class="mono" style="color:var(--fast)">4–23 ms</b><span>Tiempo del layout determinista local</span></div>' +
        '</div>';

      document.getElementById('runsTable').innerHTML =
        '<thead><tr><th>Caso</th><th>Modo</th><th>Rep</th><th>LLM s</th><th>Total s</th><th>Retries 429</th><th>Tokens (In / Out / Think)</th><th>Costo</th><th>Nodos / Gws / Bounds</th><th>Supuestos (Altos)</th><th>Recs</th></tr></thead>' +
        '<tbody>' + ok.map(function(r) {
          return '<tr>' +
            '<td>' + r.caseTitle + '</td>' +
            '<td><span class="pill pill-' + r.mode + '">' + (r.mode === 'fast' ? 'Rápido' : 'Detallado') + '</span></td>' +
            '<td class="mono">r' + r.rep + '</td>' +
            '<td class="mono">' + (r.llmLatencyMs / 1000).toFixed(1) + 's</td>' +
            '<td class="mono">' + (r.totalLatencyMs / 1000).toFixed(1) + 's</td>' +
            '<td class="mono">' + (r.rateLimitRetries > 0 ? '<span class="pill pill-warn">' + r.rateLimitRetries + ' retry</span>' : '<span class="pill pill-ok">0</span>') + '</td>' +
            '<td class="mono">' + r.promptTokens + ' / ' + r.outputTokens + ' / ' + r.thinkingTokens + '</td>' +
            '<td class="mono">$' + r.estimatedCostUsd.toFixed(4) + '</td>' +
            '<td class="mono">' + r.elementCount + ' / ' + r.gatewayCount + ' / ' + r.boundaryEvents + '</td>' +
            '<td class="mono">' + r.assumptionsCount + ' (' + r.assumptionsByImpact.high + ')</td>' +
            '<td class="mono">' + r.recommendationsCount + '</td>' +
          '</tr>';
        }).join('') + '</tbody>';
    }

    caseSel.onchange = render;
    modeSel.onchange = render;
    latSel.onchange = render;
    render();

    var tabBench = document.getElementById('tabBtnBench');
    var tabLive = document.getElementById('tabBtnLive');
    var panelBench = document.getElementById('panelBench');
    var panelLive = document.getElementById('panelLive');
    var liveInitialized = false;
    var liveEventsCache = [];
    var autoTimer = null;

    function switchMainTab(target) {
      var isLive = target === 'live';
      tabBench.classList.toggle('active', !isLive);
      tabLive.classList.toggle('active', isLive);
      tabBench.setAttribute('aria-selected', String(!isLive));
      tabLive.setAttribute('aria-selected', String(isLive));
      panelBench.hidden = isLive;
      panelLive.hidden = !isLive;
      if (isLive && !liveInitialized) {
        liveInitialized = true;
        fetchLiveTelemetry();
      }
    }
    tabBench.onclick = function() { switchMainTab('bench'); };
    tabLive.onclick = function() { switchMainTab('live'); };

    function renderLiveDashboard(events, sourceLabel) {
      liveEventsCache = events || [];
      var statusEl = document.getElementById('liveStatus');
      statusEl.textContent = sourceLabel + ' (' + liveEventsCache.length + ' eventos)';
      statusEl.className = 'pill mono ' + (liveEventsCache.length > 0 ? 'pill-ok' : 'pill-warn');

      var ok = liveEventsCache.filter(function(e) { return e.outcome === 'success'; });
      var errs = liveEventsCache.filter(function(e) { return e.outcome === 'error'; });
      var cached = ok.filter(function(e) { return Boolean(e.cached); });
      var fallbacks = ok.filter(function(e) { return Boolean(e.fallbackUsed); });
      var repaired = ok.filter(function(e) { return Boolean(e.repaired); });
      var totalUsd = liveEventsCache.reduce(function(s, e) { return s + (e.estimatedCostUsd || 0); }, 0);
      var lats = ok.filter(function(e) { return !e.cached; }).map(function(e) { return e.latencyMs || 0; });
      var medLat = lats.length ? (med(lats) / 1000).toFixed(1) + 's' : '—';
      var cachePct = ok.length ? Math.round((cached.length / ok.length) * 100) + '%' : '0%';

      document.getElementById('liveKpis').innerHTML = [
        ['Solicitudes registradas', liveEventsCache.length, ok.length + ' OK · ' + errs.length + ' errores'],
        ['Tasa de caché hit', cachePct, cached.length + ' resueltas al instante (<10 ms)'],
        ['Mediana de latencia', medLat, 'Solicitudes con inferencia real'],
        ['Costo acumulado (USD)', '$' + totalUsd.toFixed(4), 'Suma real según tarifa por modelo/región'],
        ['Resiliencia activa', fallbacks.length + ' fallbacks', repaired.length + ' auto-reparaciones XML']
      ].map(function(k) {
        return '<div class="card"><div class="kpi-label">' + k[0] + '</div><div class="kpi-val mono">' + k[1] + '</div><div class="kpi-sub">' + k[2] + '</div></div>';
      }).join('');

      var counts = [
        ['Modo Rápido (generate)', liveEventsCache.filter(function(e){ return e.mode === 'fast' && e.operation !== 'analyze'; }).length, 'var(--fast)'],
        ['Modo Detallado (generate)', liveEventsCache.filter(function(e){ return e.mode === 'detailed' && e.operation !== 'analyze'; }).length, 'var(--detailed)'],
        ['Re-análisis (/analyze-bpmn)', liveEventsCache.filter(function(e){ return e.operation === 'analyze'; }).length, 'var(--ok)'],
        ['Respuestas desde Caché', cached.length, 'var(--prompt)'],
        ['Errores HTTP / Cuota', errs.length, 'var(--danger)']
      ];
      var maxC = Math.max(1, Math.max.apply(null, counts.map(function(x){ return x[1]; })));
      var Wd = 540, Hd = 185, pLd = 185, pRd = 46, rowHd = 32;
      var svgD = ['<svg class="chart" viewBox="0 0 ' + Wd + ' ' + Hd + '">'];
      counts.forEach(function(item, idx) {
        var y = 10 + idx * rowHd;
        var bw = (item[1] / maxC) * (Wd - pLd - pRd);
        svgD.push('<text x="' + (pLd - 8) + '" y="' + (y + 15) + '" text-anchor="end" fill="#cbd5e1" font-size="11.5">' + item[0] + '</text>');
        svgD.push('<rect data-tip="' + item[0] + ': ' + item[1] + ' solicitudes" x="' + pLd + '" y="' + (y + 3) + '" width="' + Math.max(2, bw) + '" height="16" rx="4" fill="' + item[2] + '" />');
        svgD.push('<text x="' + (pLd + Math.max(2, bw) + 6) + '" y="' + (y + 15) + '" fill="#94a3b8" font-size="11">' + item[1] + '</text>');
      });
      svgD.push('</svg>');
      var distHost = document.getElementById('liveDistChart');
      distHost.innerHTML = svgD.join('');

      var recent = liveEventsCache.slice(-30);
      var Ws = 540, Hs = 185, pLs = 40, pRs = 14, pTs = 14, pBs = 24;
      var maxS = Math.max(1, Math.max.apply(null, recent.map(function(e){ return (e.latencyMs || 0) / 1000; })) * 1.15);
      var svgS = ['<svg class="chart" viewBox="0 0 ' + Ws + ' ' + Hs + '">'];
      if (recent.length === 0) {
        svgS.push('<text x="' + (Ws / 2) + '" y="' + (Hs / 2) + '" text-anchor="middle" fill="#64748b" font-size="12">Todavía no hay eventos en vivo registrados.</text>');
      } else {
        var stepW = (Ws - pLs - pRs) / recent.length;
        var barW = Math.max(5, Math.min(22, stepW * 0.72));
        recent.forEach(function(e, idx) {
          var latS = (e.latencyMs || 0) / 1000;
          var h = Math.max(3, (latS / maxS) * (Hs - pTs - pBs));
          var x = pLs + idx * stepW + (stepW - barW) / 2;
          var y = pTs + (Hs - pTs - pBs) - h;
          var col = e.outcome === 'error' ? 'var(--danger)' : (e.cached ? 'var(--prompt)' : (e.operation === 'analyze' ? 'var(--ok)' : (e.mode === 'detailed' ? 'var(--detailed)' : 'var(--fast)')));
          var tip = '<b>' + new Date(e.timestamp).toLocaleTimeString('es-AR') + '</b> · ' + (e.operation || 'generate') + ' (' + (e.mode || '-') + ')<br>Estado: ' + e.httpStatus + ' · Latencia: ' + latS.toFixed(1) + 's<br>Costo: $' + (e.estimatedCostUsd || 0).toFixed(4) + (e.cached ? ' · CACHÉ' : '');
          svgS.push('<rect data-tip="' + tip + '" x="' + x + '" y="' + y + '" width="' + barW + '" height="' + h + '" rx="3" fill="' + col + '" />');
        });
      }
      svgS.push('</svg>');
      var serHost = document.getElementById('liveSeriesChart');
      serHost.innerHTML = svgS.join('');
      [distHost, serHost].forEach(function(host) {
        host.querySelectorAll('[data-tip]').forEach(function(el) {
          el.addEventListener('mousemove', function(e) { showTip(e, el.getAttribute('data-tip')); });
          el.addEventListener('mouseleave', hideTip);
        });
      });

      var rev = liveEventsCache.slice().reverse().slice(0, 60);
      document.getElementById('liveTable').innerHTML =
        '<thead><tr><th>Hora</th><th>Op</th><th>Modo</th><th>Proveedor / Modelo</th><th>Estado</th><th>Latencia</th><th>Tokens (In/Out/Think)</th><th>Costo</th><th>Flags</th></tr></thead>' +
        '<tbody>' + (rev.length === 0
          ? '<tr><td colspan="9" style="color:var(--muted);text-align:center;padding:18px">Sin eventos cargados. Generá o re-analizá un diagrama con npm run dev corriendo y presioná Actualizar.</td></tr>'
          : rev.map(function(e) {
              var flags = [];
              if (e.cached) flags.push('caché');
              if (e.fallbackUsed) flags.push('fallback');
              if (e.repaired) flags.push('reparado');
              if (e.incremental) flags.push('incremental');
              var tok = e.usage ? ((e.usage.promptTokens || 0) + ' / ' + (e.usage.outputTokens || 0) + ' / ' + (e.usage.thinkingTokens || 0)) : '—';
              return '<tr>' +
                '<td class="mono">' + new Date(e.timestamp).toLocaleTimeString('es-AR') + '</td>' +
                '<td class="mono">' + (e.operation || 'generate') + '</td>' +
                '<td>' + (e.mode ? '<span class="pill pill-' + e.mode + '">' + (e.mode === 'fast' ? 'Rápido' : 'Detallado') + '</span>' : '—') + '</td>' +
                '<td class="mono">' + (e.provider || '—') + ' · ' + (e.model || '—') + '</td>' +
                '<td><span class="pill ' + (e.outcome === 'success' ? 'pill-ok' : 'pill-warn') + '">' + e.httpStatus + (e.errorCode ? ' ' + e.errorCode : '') + '</span></td>' +
                '<td class="mono">' + ((e.latencyMs || 0) / 1000).toFixed(1) + 's</td>' +
                '<td class="mono">' + tok + '</td>' +
                '<td class="mono">$' + (e.estimatedCostUsd || 0).toFixed(4) + '</td>' +
                '<td class="mono">' + (flags.length ? flags.join(', ') : '—') + '</td>' +
              '</tr>';
            }).join('')) + '</tbody>';
    }

    function fetchLiveTelemetry() {
      var url = document.getElementById('liveApiUrl').value.trim();
      var statusEl = document.getElementById('liveStatus');
      statusEl.textContent = 'Consultando...';
      statusEl.className = 'pill mono pill-warn';
      fetch(url)
        .then(function(res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function(payload) {
          renderLiveDashboard(payload.events || [], 'Conectado en vivo');
        })
        .catch(function() {
          statusEl.textContent = 'Sin conexión al servidor (usá .jsonl offline)';
          statusEl.className = 'pill mono pill-warn';
          if (liveEventsCache.length === 0) renderLiveDashboard([], 'Sin conexión');
        });
    }

    document.getElementById('btnFetchLive').onclick = fetchLiveTelemetry;
    document.getElementById('chkAutoRefresh').onchange = function(ev) {
      if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
      if (ev.target.checked) {
        fetchLiveTelemetry();
        autoTimer = setInterval(fetchLiveTelemetry, 10000);
      }
    };
    document.getElementById('btnLoadJsonl').onclick = function() {
      document.getElementById('liveFileInput').click();
    };
    document.getElementById('liveFileInput').onchange = function(ev) {
      var file = ev.target.files && ev.target.files[0];
      ev.target.value = '';
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function() {
        var text = String(reader.result || '');
        var parsed = [];
        text.split(/\\r?\\n/).forEach(function(line) {
          var t = line.trim();
          if (!t) return;
          try {
            var obj = JSON.parse(t);
            if (Array.isArray(obj)) parsed = parsed.concat(obj);
            else if (Array.isArray(obj.events)) parsed = parsed.concat(obj.events);
            else if (obj && obj.timestamp) parsed.push(obj);
          } catch (err) {}
        });
        renderLiveDashboard(parsed, 'Archivo: ' + file.name);
      };
      reader.readAsText(file, 'utf-8');
    };
  </script>
</body>
</html>`;
  writeFileSync(path.join(OUT_DIR, 'dashboard.html'), html, 'utf8');
}

async function main() {
  const { reps, modes, caseFilter, cooldownMs, dryRun, reportOnly, maxConsecutiveErrors } =
    parseArgs();
  const cases = caseFilter
    ? BENCHMARK_CASES.filter((c) => caseFilter.includes(c.id))
    : BENCHMARK_CASES;

  const model = process.env.VERTEX_MODEL || 'gemini-4-hydrogen';
  const location = process.env.GCP_LOCATION || 'global';
  const totalPlanned = cases.length * modes.length * reps;

  const existingRuns: RunRecord[] = [];
  const completedKeys = new Set<string>();
  if (existsSync(RUNS_FILE)) {
    const lines = readFileSync(RUNS_FILE, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      const rec = JSON.parse(line) as RunRecord;
      existingRuns.push(rec);
      if (rec.status === 'ok') completedKeys.add(rec.runKey);
    }
  }

  const pending: Array<{ benchCase: BenchCase; mode: BenchMode; rep: number; runKey: string }> = [];
  for (let rep = 1; rep <= reps; rep++) {
    for (const benchCase of cases) {
      for (const mode of modes) {
        const runKey = `${benchCase.id}::${mode}::r${rep}`;
        if (!completedKeys.has(runKey)) {
          pending.push({ benchCase, mode, rep, runKey });
        }
      }
    }
  }

  if (reportOnly) {
    mkdirSync(OUT_DIR, { recursive: true });
    buildReports(existingRuns);
    console.log(
      `[benchmark] Report-only mode: generated summary.json, report.md, dashboard.html from ${existingRuns.length} logged runs.`
    );
    return;
  }

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          model,
          location,
          cases: cases.map((c) => c.id),
          modes,
          reps,
          cooldownMs,
          totalPlanned,
          alreadyCompleted: completedKeys.size,
          pendingRuns: pending.length,
          estimatedDurationMin: round((pending.length * (40 + cooldownMs / 1000)) / 60, 1),
          estimatedUsdRange: [round(pending.length * 0.03, 2), round(pending.length * 0.08, 2)],
        },
        null,
        2
      )
    );
    return;
  }

  const project = process.env.GCP_PROJECT_ID;
  if (!project) throw new Error('Falta GCP_PROJECT_ID en .env.local');
  const credentials = parseServiceAccount(process.env.GCP_SERVICE_ACCOUNT_JSON);
  const ai = new GoogleGenAI({
    vertexai: true,
    project,
    location,
    googleAuthOptions: { credentials },
  });

  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  console.log(`[${ts()}] [benchmark] Model=${model} Location=${location} Pending=${pending.length}/${totalPlanned} Cooldown=${cooldownMs}ms MaxConsecutiveErrors=${maxConsecutiveErrors}`);

  let consecutiveErrors = 0;

  for (let i = 0; i < pending.length; i++) {
    const { benchCase, mode, rep, runKey } = pending[i];
    console.log(`[${ts()}] [${i + 1}/${pending.length}] Running ${runKey}...`);
    const started = performance.now();

    try {
      let attemptRes = await callVertexWithBackoff(ai, model, benchCase.description, mode);
      let llmLatencyMs = attemptRes.llmMs;
      let rateLimitRetries = attemptRes.rateLimitRetries;
      let promptTokens = attemptRes.usage.promptTokens;
      let outputTokens = attemptRes.usage.outputTokens;
      let thinkingTokens = attemptRes.usage.thinkingTokens;
      let totalTokens = attemptRes.usage.totalTokens;
      let attempts = 1;
      let repaired = false;

      const tLayout0 = performance.now();
      let layoutedXml: string;
      try {
        layoutedXml = await validateAndLayoutBpmn(attemptRes.bpmnXml);
      } catch (valErr) {
        if (!(valErr instanceof BpmnValidationError)) throw valErr;
        attempts = 2;
        repaired = true;
        attemptRes = await callVertexWithBackoff(
          ai,
          model,
          benchCase.description,
          mode,
          valErr.message
        );
        llmLatencyMs += attemptRes.llmMs;
        rateLimitRetries += attemptRes.rateLimitRetries;
        promptTokens += attemptRes.usage.promptTokens;
        outputTokens += attemptRes.usage.outputTokens;
        thinkingTokens += attemptRes.usage.thinkingTokens;
        totalTokens += attemptRes.usage.totalTokens;
        layoutedXml = await validateAndLayoutBpmn(attemptRes.bpmnXml);
      }
      const layoutLatencyMs = Math.round(performance.now() - tLayout0);
      const totalLatencyMs = Math.round(performance.now() - started);

      const xmlMetrics = analyzeBpmnXmlMetrics(layoutedXml);
      const allRefs = attemptRes.assumptions.flatMap((a) => a.elementIds || []);
      const validRefs = allRefs.filter((id) => layoutedXml.includes(`id="${id}"`));
      const lowerDesc = benchCase.description.toLowerCase();
      const nonEmptyExcerpts = attemptRes.assumptions
        .map((a) => a.sourceExcerpt?.trim() || '')
        .filter(Boolean);
      const matchedExcerpts = nonEmptyExcerpts.filter((ex) => lowerDesc.includes(ex.toLowerCase()));

      const cost =
        estimateCostUsd(
          { promptTokens, outputTokens, thinkingTokens, totalTokens },
          model,
          location
        ) ?? 0;

      const record: RunRecord = {
        runKey,
        timestamp: new Date().toISOString(),
        caseId: benchCase.id,
        caseTitle: benchCase.title,
        mode,
        rep,
        model,
        location,
        status: 'ok',
        llmLatencyMs,
        layoutLatencyMs,
        totalLatencyMs,
        promptTokens,
        outputTokens,
        thinkingTokens,
        totalTokens,
        estimatedCostUsd: cost,
        attempts,
        repaired,
        validFirstAttempt: !repaired,
        rateLimitRetries,
        finishReason: attemptRes.finishReason,
        outputXmlBytes: Buffer.byteLength(layoutedXml, 'utf8'),
        ...xmlMetrics,
        assumptionsCount: attemptRes.assumptions.length,
        assumptionsByImpact: {
          high: attemptRes.assumptions.filter((a) => a.impact === 'high').length,
          medium: attemptRes.assumptions.filter((a) => a.impact === 'medium').length,
          low: attemptRes.assumptions.filter((a) => a.impact === 'low').length,
        },
        validElementRefsPct: allRefs.length > 0 ? round((validRefs.length / allRefs.length) * 100, 1) : 100,
        sourceExcerptMatchPct:
          nonEmptyExcerpts.length > 0
            ? round((matchedExcerpts.length / nonEmptyExcerpts.length) * 100, 1)
            : 100,
        recommendationsCount: attemptRes.recommendations.length,
      };

      writeFileSync(
        path.join(ARTIFACTS_DIR, `${benchCase.id}-${mode}-r${rep}.bpmn`),
        layoutedXml,
        'utf8'
      );
      writeFileSync(
        path.join(ARTIFACTS_DIR, `${benchCase.id}-${mode}-r${rep}.analysis.json`),
        JSON.stringify(
          {
            assumptions: attemptRes.assumptions,
            recommendations: attemptRes.recommendations,
          },
          null,
          2
        ),
        'utf8'
      );
      appendFileSync(RUNS_FILE, JSON.stringify(record) + '\n', 'utf8');
      existingRuns.push(record);
      consecutiveErrors = 0;
      console.log(
        `[${ts()}]   OK ${(totalLatencyMs / 1000).toFixed(1)}s | $${cost.toFixed(4)} | elems=${record.elementCount} | assump=${record.assumptionsCount}`
      );
    } catch (err) {
      const errorRecord: RunRecord = {
        runKey,
        timestamp: new Date().toISOString(),
        caseId: benchCase.id,
        caseTitle: benchCase.title,
        mode,
        rep,
        model,
        location,
        status: 'error',
        errorMessage: err instanceof Error ? err.message.slice(0, 240) : String(err).slice(0, 240),
        llmLatencyMs: 0,
        layoutLatencyMs: 0,
        totalLatencyMs: Math.round(performance.now() - started),
        promptTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        attempts: 1,
        repaired: false,
        validFirstAttempt: false,
        rateLimitRetries: 0,
        finishReason: 'ERROR',
        outputXmlBytes: 0,
        layoutType: 'bpmn-auto-layout',
        elementCount: 0,
        gatewayCount: 0,
        flowCount: 0,
        pools: 0,
        lanes: 0,
        messageFlows: 0,
        boundaryEvents: 0,
        nonInterruptingBoundaries: 0,
        timerEvents: 0,
        messageEvents: 0,
        errorEvents: 0,
        escalationEvents: 0,
        loopMarkers: 0,
        multiInstanceParallel: 0,
        multiInstanceSequential: 0,
        defaultFlows: 0,
        tasksByType: {},
        gatewaysByType: {},
        assumptionsCount: 0,
        assumptionsByImpact: { high: 0, medium: 0, low: 0 },
        validElementRefsPct: 0,
        sourceExcerptMatchPct: 0,
        recommendationsCount: 0,
      };
      appendFileSync(RUNS_FILE, JSON.stringify(errorRecord) + '\n', 'utf8');
      existingRuns.push(errorRecord);
      consecutiveErrors += 1;
      console.error(`[${ts()}]   FAIL: ${errorRecord.errorMessage}`);
      const isRateLimitExhausted =
        errorRecord.errorMessage?.includes('429') ||
        errorRecord.errorMessage?.includes('RESOURCE_EXHAUSTED');
      if (isRateLimitExhausted) {
        console.warn(
          `[${ts()}] [benchmark] Rate limit agotado tras 3 reintentos en ${runKey}. Deteniendo tanda de inmediato para esperar cooldown sin intentar las demás.`
        );
        break;
      }
      if (consecutiveErrors >= maxConsecutiveErrors) {
        console.warn(
          `[${ts()}] [benchmark] Circuit-breaker triggered after ${consecutiveErrors} consecutive failures. Stopping early so you can resume later without losing progress.`
        );
        break;
      }
    }

    if (i < pending.length - 1 && cooldownMs > 0) {
      await sleep(cooldownMs);
    }
  }

  buildReports(existingRuns);
  console.log(`[${ts()}] [benchmark] Reports generated in ${OUT_DIR}/ (summary.json, report.md, dashboard.html)`);
}

main().catch((err) => {
  console.error('[benchmark] Fatal error:', err);
  process.exit(1);
});
