import { afterEach, describe, expect, it } from "vitest";
import { isTradePilotEmailLookupConfigured, tradePilotUserIdFromEmail } from "../trade-pilot-user-id";

/*
 * Vektor uji ini juga harus dihasilkan oleh `tradePilotUserId()` di get-sgb
 * (HMAC-SHA256 "trade-pilot:{email}" dengan normalisasi trim+lowercase).
 * Kalau test ini gagal, pencarian email di konsol admin tidak akan cocok
 * dengan userId yang dikirim get-sgb.
 */
const SECRET = "test-secret-0123456789";
const EXPECTED = "fe83fec412765c6050cd085edd5acb86fab4c7f6fed39dbc61e6ef2d5c3037e7";

describe("tradePilotUserIdFromEmail", () => {
  afterEach(() => {
    delete process.env.TRADE_PILOT_USER_ID_SECRET;
  });

  it("matches the get-sgb blind index for a normalized email", () => {
    expect(tradePilotUserIdFromEmail("budi@example.com", SECRET)).toBe(EXPECTED);
  });

  it("normalizes case and surrounding whitespace like get-sgb", () => {
    expect(tradePilotUserIdFromEmail("  Budi@Example.COM ", SECRET)).toBe(EXPECTED);
  });

  it("returns null when the secret is not configured", () => {
    expect(isTradePilotEmailLookupConfigured()).toBe(false);
    expect(tradePilotUserIdFromEmail("budi@example.com")).toBeNull();
  });

  it("reads the secret from TRADE_PILOT_USER_ID_SECRET", () => {
    process.env.TRADE_PILOT_USER_ID_SECRET = SECRET;
    expect(isTradePilotEmailLookupConfigured()).toBe(true);
    expect(tradePilotUserIdFromEmail("budi@example.com")).toBe(EXPECTED);
  });
});
