interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 10;
export const MAX_STORE_SIZE = 2000;
const store = new Map<string, RateLimitEntry>();

export function extractClientIp(headers: { get: (name: string) => string | null }): string {
  const vercelFwd = headers.get('x-vercel-forwarded-for');
  if (vercelFwd) {
    const first = vercelFwd.split(',')[0]?.trim();
    if (first) return first;
  }

  const realIp = headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;

  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const parts = forwarded
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }

  return 'local';
}

function cleanupExpired(now: number, force = false): void {
  if (!force && store.size < 200) return;
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt <= now) {
      store.delete(key);
    }
  }
}

export function checkRateLimit(clientKey: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  cleanupExpired(now);

  const existing = store.get(clientKey);
  if (!existing || existing.resetAt <= now) {
    if (!existing && store.size >= MAX_STORE_SIZE) {
      cleanupExpired(now, true);
      while (store.size >= MAX_STORE_SIZE) {
        const oldestKey = store.keys().next().value;
        if (oldestKey === undefined) break;
        store.delete(oldestKey);
      }
    }
    store.set(clientKey, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfterSec: 0 };
  }

  if (existing.count >= MAX_REQUESTS) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}
