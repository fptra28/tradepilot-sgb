import { createHmac } from "node:crypto";

/**
 * Blind index userId TradePilot — HARUS identik dengan `tradePilotUserId()`
 * di get-sgb: HMAC-SHA256(`trade-pilot:{email}`) dengan secret yang sama,
 * email di-normalisasi `trim().toLowerCase()`, hasil 64 hex.
 *
 * Dipakai konsol admin untuk mencari nasabah via email tanpa menyimpan email.
 * Secret hanya boleh ada di env server (TRADE_PILOT_USER_ID_SECRET).
 */
export function tradePilotUserIdFromEmail(email: string, secret = process.env.TRADE_PILOT_USER_ID_SECRET?.trim() ?? ""): string | null {
  if (!secret) return null;
  return createHmac("sha256", secret)
    .update(`trade-pilot:${email.trim().toLowerCase()}`)
    .digest("hex");
}

export function isTradePilotEmailLookupConfigured(): boolean {
  return Boolean(process.env.TRADE_PILOT_USER_ID_SECRET?.trim());
}
