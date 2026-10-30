/**
 * Per-user limiter for POST /v1/trade-pilot/analyses:
 *  - at most TRADE_PILOT_MAX_CONCURRENT_ANALYSES running per user (default 1)
 *  - at most TRADE_PILOT_MAX_ANALYSES_PER_MINUTE started per user (default 10)
 *
 * In-memory, so limits are per process. When the API runs with several
 * replicas, put a shared store (e.g. Redis) behind the same interface.
 */
const running = new Map<string, number>();
const started = new Map<string, number[]>();

function limit(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export type RateLimitDecision =
  | { allowed: true; release: () => void }
  | { allowed: false; retryAfterSeconds: number };

export function acquireAnalysisSlot(userId: string, now = Date.now()): RateLimitDecision {
  const maxConcurrent = limit("TRADE_PILOT_MAX_CONCURRENT_ANALYSES", 1);
  const maxPerMinute = limit("TRADE_PILOT_MAX_ANALYSES_PER_MINUTE", 10);
  const windowStart = now - 60_000;
  const recent = (started.get(userId) ?? []).filter((at) => at > windowStart);

  if ((running.get(userId) ?? 0) >= maxConcurrent) {
    started.set(userId, recent);
    return { allowed: false, retryAfterSeconds: 5 };
  }
  if (recent.length >= maxPerMinute) {
    started.set(userId, recent);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0]! + 60_000 - now) / 1000)) };
  }
  recent.push(now);
  started.set(userId, recent);
  running.set(userId, (running.get(userId) ?? 0) + 1);
  let released = false;
  return {
    allowed: true,
    release: () => {
      if (released) return;
      released = true;
      const count = (running.get(userId) ?? 1) - 1;
      if (count <= 0) running.delete(userId);
      else running.set(userId, count);
    },
  };
}

/** Test helper. */
export function _resetTradePilotRateLimit(): void {
  running.clear();
  started.clear();
}
