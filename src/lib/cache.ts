import { createHash } from 'node:crypto';
import type { ModelingRecommendation, StructuredAssumption } from '@/lib/llm/types';

export const CACHE_VERSION = 'v0.7.0-layout3';

export interface CachedBpmnEntry {
  bpmnXml: string;
  assumptions: StructuredAssumption[];
  recommendations?: ModelingRecommendation[];
  provider: string;
  model: string;
  expiresAt: number;
}

const TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 50;
const cache = new Map<string, CachedBpmnEntry>();

export function buildCacheKey(
  processDescription: string,
  mode = 'detailed',
  model?: string
): string {
  const activeModel = model || process.env.VERTEX_MODEL || 'gemini-4-hydrogen';
  const normalized = processDescription.trim().replace(/\s+/g, ' ').toLowerCase();
  return createHash('sha256')
    .update(`${CACHE_VERSION}:${activeModel}:${mode}:${normalized}`)
    .digest('hex');
}

export function getCachedBpmn(key: string): CachedBpmnEntry | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry;
}

export function setCachedBpmn(
  key: string,
  value: Omit<CachedBpmnEntry, 'expiresAt'>
): void {
  if (cache.size >= MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, {
    ...value,
    expiresAt: Date.now() + TTL_MS,
  });
}
