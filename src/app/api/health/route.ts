import { NextResponse } from 'next/server';

export async function GET() {
  const configured = Boolean(
    process.env.GCP_PROJECT_ID && process.env.GCP_SERVICE_ACCOUNT_JSON
  );
  const fallbackConfigured = Boolean(process.env.GROQ_API_KEY?.trim());

  return NextResponse.json({
    status: configured ? 'ok' : 'degraded',
    provider: 'vertex-ai',
    model: process.env.VERTEX_MODEL || 'gemini-4-hydrogen',
    location: process.env.GCP_LOCATION || 'global',
    configured,
    fallbackProvider: fallbackConfigured ? 'groq' : null,
    fallbackModel: fallbackConfigured ? process.env.GROQ_MODEL || 'openai/gpt-oss-120b' : null,
    timestamp: new Date().toISOString(),
  });
}
