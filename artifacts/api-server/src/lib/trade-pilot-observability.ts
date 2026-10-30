import { lt, sql } from "drizzle-orm";
import { tradePilotOperationalEvents, tradePilotOperationalHealth } from "@workspace/db/schema";
import { db } from "./db";
import { logger } from "./logger";

export type OperationalEventCategory = "openai" | "alert_webhook";

/** Best-effort snapshot write: observability must never break production work. */
export async function recordOperationalHealth(
  key: string,
  success: boolean,
  details: Record<string, unknown> = {},
): Promise<void> {
  const now = new Date();
  try {
    await db.insert(tradePilotOperationalHealth)
      .values({
        key,
        lastSuccessAt: success ? now : null,
        lastFailureAt: success ? null : now,
        checkedAt: now,
        details,
      })
      .onConflictDoUpdate({
        target: tradePilotOperationalHealth.key,
        set: {
          lastSuccessAt: success ? now : sql`${tradePilotOperationalHealth.lastSuccessAt}`,
          lastFailureAt: success ? sql`${tradePilotOperationalHealth.lastFailureAt}` : now,
          checkedAt: now,
          details,
        },
      });
  } catch (error) {
    logger.warn({ err: error, healthKey: key }, "Trade Pilot operational health write failed");
  }
}

/** Event + latest-state write for rolling failure-rate metrics. */
export async function recordOperationalEvent(
  category: OperationalEventCategory,
  success: boolean,
  details: Record<string, unknown> = {},
): Promise<void> {
  try {
    await db.insert(tradePilotOperationalEvents).values({ category, success, details });
  } catch (error) {
    logger.warn({ err: error, category }, "Trade Pilot operational event write failed");
  }
  await recordOperationalHealth(category, success, details);
}

export async function recordObservedJob(
  name: "signal_evaluation" | "performance_aggregation",
  fn: () => Promise<void>,
): Promise<void> {
  const startedAt = Date.now();
  try {
    await fn();
    await recordOperationalHealth(`job:${name}`, true, { durationMs: Date.now() - startedAt });
  } catch (error) {
    await recordOperationalHealth(`job:${name}`, false, {
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message.slice(0, 300) : "unknown_error",
    });
    throw error;
  }
}

export async function cleanupOperationalEvents(before: Date): Promise<void> {
  try {
    await db.delete(tradePilotOperationalEvents).where(lt(tradePilotOperationalEvents.createdAt, before));
  } catch (error) {
    logger.warn({ err: error }, "Trade Pilot operational event cleanup failed");
  }
}
