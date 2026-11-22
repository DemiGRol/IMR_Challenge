import { NextResponse } from 'next/server';

export async function GET() {
  const configured = Boolean(
    process.env.GCP_PROJECT_ID && process.env.GCP_SERVICE_ACCOUNT_JSON
  );

  return NextResponse.json({
    status: configured ? 'ok' : 'degraded',
    provider: 'vertex-ai',
    model: process.env.VERTEX_MODEL || 'gemini-4-hydrogen',
    location: process.env.GCP_LOCATION || 'global',
    configured,
    timestamp: new Date().toISOString(),
  });
}
