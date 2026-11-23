import { NextResponse } from 'next/server';

export async function GET() {
  const studioConfigured = Boolean(process.env.GEMINI_API_KEY?.trim());
  const vertexConfigured = Boolean(
    process.env.GCP_PROJECT_ID && process.env.GCP_SERVICE_ACCOUNT_JSON
  );
  const configured = studioConfigured || vertexConfigured;

  return NextResponse.json({
    status: configured ? 'ok' : 'degraded',
    primary: vertexConfigured
      ? { provider: 'vertex-ai', model: process.env.VERTEX_MODEL || 'gemini-4-hydrogen', location: process.env.GCP_LOCATION || 'global' }
      : studioConfigured
        ? { provider: 'google-ai-studio', model: process.env.GEMINI_STUDIO_MODEL || 'gemini-4-hydrogen' }
        : null,
    fallback:
      vertexConfigured && studioConfigured
        ? { provider: 'google-ai-studio', model: process.env.GEMINI_STUDIO_MODEL || 'gemini-4-hydrogen' }
        : null,
    configured,
    timestamp: new Date().toISOString(),
  });
}
