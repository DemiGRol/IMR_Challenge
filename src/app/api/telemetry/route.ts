import { NextRequest, NextResponse } from 'next/server';
import { getLiveTelemetryEvents } from '@/lib/telemetry';

function buildTelemetryHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Cache-Control': 'no-store',
  };
  const isVercel = process.env.VERCEL === '1';
  if (!isVercel) {
    headers['Access-Control-Allow-Origin'] = '*';
    headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Telemetry-Token';
  } else if (process.env.TELEMETRY_CORS_ORIGIN?.trim()) {
    headers['Access-Control-Allow-Origin'] = process.env.TELEMETRY_CORS_ORIGIN.trim();
    headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Telemetry-Token';
  }
  return headers;
}

function authorizeTelemetryRequest(req: NextRequest): NextResponse | null {
  if (process.env.VERCEL !== '1') return null;

  const expectedToken = process.env.TELEMETRY_API_TOKEN?.trim();
  if (!expectedToken) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const headerToken = req.headers.get('x-telemetry-token')?.trim();
  const authHeader = req.headers.get('authorization')?.trim();
  const bearerToken = authHeader?.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : '';

  if (headerToken !== expectedToken && bearerToken !== expectedToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: buildTelemetryHeaders() });
}

export async function GET(req: NextRequest) {
  const denied = authorizeTelemetryRequest(req);
  if (denied) return denied;

  const events = getLiveTelemetryEvents(200);
  const okEvents = events.filter((e) => e.outcome === 'success');
  const errorEvents = events.filter((e) => e.outcome === 'error');
  const cachedCount = okEvents.filter((e) => Boolean(e.cached)).length;
  const fallbackCount = okEvents.filter((e) => Boolean(e.fallbackUsed)).length;
  const repairedCount = okEvents.filter((e) => Boolean(e.repaired)).length;
  const totalEstimatedCostUsd = Number(
    events.reduce((sum, e) => sum + (e.estimatedCostUsd ?? 0), 0).toFixed(6)
  );

  const latencies = okEvents
    .filter((e) => !e.cached)
    .map((e) => e.latencyMs)
    .sort((a, b) => a - b);
  const medianLatencyMs =
    latencies.length > 0 ? latencies[Math.floor(latencies.length / 2)] : 0;

  return NextResponse.json(
    {
      generatedAt: new Date().toISOString(),
      summary: {
        total: events.length,
        ok: okEvents.length,
        errors: errorEvents.length,
        cached: cachedCount,
        fallbacks: fallbackCount,
        repaired: repairedCount,
        totalEstimatedCostUsd,
        medianLatencyMs,
        byMode: {
          fast: events.filter((e) => e.mode === 'fast' && e.operation !== 'analyze').length,
          detailed: events.filter((e) => e.mode === 'detailed' && e.operation !== 'analyze').length,
          analyze: events.filter((e) => e.operation === 'analyze').length,
        },
      },
      events,
    },
    { headers: buildTelemetryHeaders() }
  );
}
