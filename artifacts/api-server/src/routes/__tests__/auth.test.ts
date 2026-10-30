import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { eq, inArray, like } from "drizzle-orm";

import app from "../../app";
import { db } from "../../lib/db";
import {
  users,
  sessions,
  passwordResetTokens,
  reauthTokens,
} from "@workspace/db/schema";
import {
  loginLimiter,
  registerLimiter,
  forgotPasswordResetLimiter,
  googleOAuthLimiter,
  googleNativeLoginLimiter,
  appleNativeLoginLimiter,
  reauthLimiter,
  accountDeletionLimiter,
} from "../../middleware/rate-limit";
import {
  getConfiguredPublicBaseOrigin,
  getConfiguredReplitOrigins,
} from "../../app";
import {
  exchangeCodeForProfile,
  verifyGoogleIdToken,
} from "../../lib/google-oauth";
import {
  verifyAppleIdentityToken,
  exchangeAppleAuthorizationCode,
} from "../../lib/apple-oauth";

// Keep the real config/url helpers, stub only the network-touching Google
// token calls so the tests can drive any Google profile.
vi.mock("../../lib/google-oauth", async (importActual) => {
  const actual =
    await importActual<typeof import("../../lib/google-oauth")>();
  return {
    ...actual,
    exchangeCodeForProfile: vi.fn(),
    verifyGoogleIdToken: vi.fn(),
  };
});
const mockExchange = vi.mocked(exchangeCodeForProfile);
const mockVerifyIdToken = vi.mocked(verifyGoogleIdToken);

// Same pattern for Apple: keep isNativeAppleConfigured/nativeAppleAudiences
// real (driven by env vars in the describe block below), stub only the
// two calls that touch Apple's network (JWKS verification + the
// authorization-code exchange).
vi.mock("../../lib/apple-oauth", async (importActual) => {
  const actual = await importActual<typeof import("../../lib/apple-oauth")>();
  return {
    ...actual,
    verifyAppleIdentityToken: vi.fn(),
    exchangeAppleAuthorizationCode: vi.fn(),
  };
});
const mockVerifyAppleToken = vi.mocked(verifyAppleIdentityToken);
const mockExchangeAppleCode = vi.mocked(exchangeAppleAuthorizationCode);

const RUN_ID = randomBytes(4).toString("hex");
const EMAIL_PREFIX = `auth-harden-${RUN_ID}`;
const SECURITY_QUESTION = "Nama hewan peliharaan pertama kamu?";
const PASSWORD = "Correct123";
const seededIds: number[] = [];

interface SeedUser {
  id: number;
  email: string;
  token: string;
}

async function createUser(): Promise<SeedUser> {
  const suffix = randomBytes(6).toString("hex");
  const email = `${EMAIL_PREFIX}-${suffix}@example.test`;
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const securityAnswerHash = await bcrypt.hash("answer", 4);
  const [row] = await db
    .insert(users)
    .values({
      email,
      passwordHash,
      displayName: `Auth Harden ${RUN_ID} ${suffix}`,
      securityQuestion: SECURITY_QUESTION,
      securityAnswerHash,
    })
    .returning({ id: users.id });

  const token = `auth-harden-${RUN_ID}-${suffix}-${randomBytes(8).toString("hex")}`;
  await db.insert(sessions).values({
    userId: row.id,
    token,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });

  seededIds.push(row.id);
  return { id: row.id, email, token };
}

beforeAll(async () => {
  // Sanity row so the suite has at least one tagged user.
  await createUser();
});

afterAll(async () => {
  if (seededIds.length > 0) {
    await db
      .delete(passwordResetTokens)
      .where(inArray(passwordResetTokens.userId, seededIds));
    await db.delete(sessions).where(inArray(sessions.userId, seededIds));
    await db.delete(users).where(inArray(users.id, seededIds));
  }
  // Sweep prefix-tagged residue from any failed tests (defense in depth).
  await db.delete(users).where(like(users.email, `${EMAIL_PREFIX}%`));
});

beforeEach(() => {
  // Limiter stores are module-scoped Maps shared across all tests in this
  // file. Supertest always connects from 127.0.0.1, so the per-IP limiters
  // would otherwise bleed state across cases. Clear before every test so
  // each one starts from a clean budget.
  loginLimiter.store.clear();
  registerLimiter.store.clear();
  forgotPasswordResetLimiter.store.clear();
  googleOAuthLimiter.store.clear();
  googleNativeLoginLimiter.store.clear();
  appleNativeLoginLimiter.store.clear();
  reauthLimiter.store.clear();
  accountDeletionLimiter.store.clear();
});

describe("configured Replit CORS origins", () => {
  it("allows explicit published Replit domains without allowing a wildcard", () => {
    const origins = getConfiguredReplitOrigins([
      "trade-pilot-23newsmaker.replit.app, https://preview.example.test",
      "ignored.invalid:bad-port",
    ]);

    expect(origins).toEqual(
      new Set([
        "https://trade-pilot-23newsmaker.replit.app",
        "https://preview.example.test",
      ]),
    );
    expect(origins.has("https://another-app.replit.app")).toBe(false);
  });
});

describe("configured public base CORS origin", () => {
  it("allows HTTPS origins and local HTTP origins exactly", () => {
    expect(getConfiguredPublicBaseOrigin("https://tradepilot.id/path")).toBe(
      "https://tradepilot.id",
    );
    expect(getConfiguredPublicBaseOrigin("http://localhost:5000/path")).toBe(
      "http://localhost:5000",
    );
    expect(getConfiguredPublicBaseOrigin("http://127.0.0.1:5000")).toBe(
      "http://127.0.0.1:5000",
    );
  });

  it("rejects invalid and non-local plain HTTP origins", () => {
    expect(getConfiguredPublicBaseOrigin("http://example.com")).toBeUndefined();
    expect(getConfiguredPublicBaseOrigin("not a URL")).toBeUndefined();
  });
});

describe("PATCH /auth/profile validation", () => {
  it("returns 400 for an invalid selectedMode (no longer 500)", async () => {
    const u = await createUser();
    const res = await request(app)
      .patch("/api/auth/profile")
      .set("Authorization", `Bearer ${u.token}`)
      .send({ selectedMode: "rocket-mode" });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(res.body.error.toLowerCase()).toContain("mode");
  });

  it("returns 400 for an invalid themePreference", async () => {
    const u = await createUser();
    const res = await request(app)
      .patch("/api/auth/profile")
      .set("Authorization", `Bearer ${u.token}`)
      .send({ themePreference: "neon" });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(res.body.error.toLowerCase()).toContain("tema");
  });

  it("returns 400 when onboardingCompleted is not a boolean", async () => {
    const u = await createUser();
    const res = await request(app)
      .patch("/api/auth/profile")
      .set("Authorization", `Bearer ${u.token}`)
      .send({ onboardingCompleted: "yes-please" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when displayName is empty", async () => {
    const u = await createUser();
    const res = await request(app)
      .patch("/api/auth/profile")
      .set("Authorization", `Bearer ${u.token}`)
      .send({ displayName: "" });
    expect(res.status).toBe(400);
  });

  it("rejects unknown fields (strict schema, no silent column writes)", async () => {
    const u = await createUser();
    const res = await request(app)
      .patch("/api/auth/profile")
      .set("Authorization", `Bearer ${u.token}`)
      .send({ role: "super_admin" });
    expect(res.status).toBe(400);
  });

  it("happy path: accepts a valid update and returns the new profile", async () => {
    const u = await createUser();
    const res = await request(app)
      .patch("/api/auth/profile")
      .set("Authorization", `Bearer ${u.token}`)
      .send({
        selectedMode: "pro",
        themePreference: "dark",
        displayName: "Renamed Trader",
        onboardingCompleted: true,
      });
    expect(res.status).toBe(200);
    expect(res.body.selectedMode).toBe("pro");
    expect(res.body.themePreference).toBe("dark");
    expect(res.body.displayName).toBe("Renamed Trader");
    expect(res.body.onboardingCompleted).toBe(true);
  });

  it("requires auth (401 without a session)", async () => {
    const res = await request(app)
      .patch("/api/auth/profile")
      .send({ selectedMode: "pro" });
    expect(res.status).toBe(401);
  });
});

describe("POST /auth/login rate limiting", () => {
  it("returns 429 with Retry-After once the per-(ip,email) limit is exceeded", async () => {
    const u = await createUser();
    // 10 wrong attempts should all return 401 (limit is 10).
    for (let i = 0; i < 10; i++) {
      const r = await request(app)
        .post("/api/auth/login")
        .send({ email: u.email, password: "definitely-wrong" });
      expect(r.status).toBe(401);
    }
    // The 11th attempt — still wrong password — should now be blocked at the
    // limiter, before bcrypt even runs.
    const blocked = await request(app)
      .post("/api/auth/login")
      .send({ email: u.email, password: "definitely-wrong" });
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(typeof blocked.body.error).toBe("string");
    expect(blocked.body.error).toMatch(/login/i);
  });

  it("does not block a different account on the same IP (key includes email)", async () => {
    const u1 = await createUser();
    const u2 = await createUser();
    // Burn u1's budget.
    for (let i = 0; i < 10; i++) {
      await request(app)
        .post("/api/auth/login")
        .send({ email: u1.email, password: "wrong" });
    }
    const blocked = await request(app)
      .post("/api/auth/login")
      .send({ email: u1.email, password: "wrong" });
    expect(blocked.status).toBe(429);

    // u2 must still be able to log in successfully — limiter is per (ip,email).
    const ok = await request(app)
      .post("/api/auth/login")
      .send({ email: u2.email, password: PASSWORD });
    expect(ok.status).toBe(200);
  });
});

describe("POST /auth/register rate limiting", () => {
  it("returns 429 with Retry-After once the per-IP limit is exceeded", async () => {
    // 10 fresh registrations succeed (limit is 10/hour/ip in test env).
    for (let i = 0; i < 10; i++) {
      const suffix = randomBytes(6).toString("hex");
      const r = await request(app)
        .post("/api/auth/register")
        .send({
          email: `${EMAIL_PREFIX}-rl-${suffix}@example.test`,
          password: "Password123",
          displayName: `RL ${suffix}`,
          selectedMode: "beginner",
          securityQuestion: SECURITY_QUESTION,
          securityAnswer: "x",
        });
      expect([201, 409]).toContain(r.status);
    }
    // 11th attempt is blocked before any DB work.
    const blocked = await request(app)
      .post("/api/auth/register")
      .send({
        email: `${EMAIL_PREFIX}-rl-${randomBytes(6).toString("hex")}@example.test`,
        password: "Password123",
        displayName: "blocked",
        selectedMode: "beginner",
        securityQuestion: SECURITY_QUESTION,
        securityAnswer: "x",
      });
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(blocked.body.error).toMatch(/(pendaftaran|sign-?up)/i);

    // Cleanup: scrub the rl-tagged users this test just inserted.
    await db.delete(users).where(like(users.email, `${EMAIL_PREFIX}-rl-%`));
  }, 60_000);
});

describe("POST /auth/forgot-password/reset rate limiting", () => {
  it("returns 429 once the per-IP limit is exceeded", async () => {
    // 5 attempts with garbage tokens — each returns 401 (limit is 5/15min/ip).
    for (let i = 0; i < 5; i++) {
      const r = await request(app)
        .post("/api/auth/forgot-password/reset")
        .send({
          resetToken: `bogus-${RUN_ID}-${randomBytes(8).toString("hex")}`,
          newPassword: "Password123",
        });
      expect(r.status).toBe(401);
    }
    const blocked = await request(app)
      .post("/api/auth/forgot-password/reset")
      .send({
        resetToken: `bogus-${RUN_ID}-${randomBytes(8).toString("hex")}`,
        newPassword: "Password123",
      });
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(blocked.body.error).toMatch(/(reset|password)/i);
  });
});

// Regression: limiter middleware runs BEFORE the route's Zod schema, so
// hostile payloads like `email: 123` or `email: {}` must never crash the
// keyFn (or the route) into a 500. Each of these returns a clean 400.
describe("auth endpoints reject malformed body types without 500", () => {
  it("POST /auth/login with non-string email returns 400, not 500", async () => {
    const r1 = await request(app)
      .post("/api/auth/login")
      .send({ email: 12345, password: "Password123" });
    expect(r1.status).toBe(400);

    const r2 = await request(app)
      .post("/api/auth/login")
      .send({ email: { foo: "bar" }, password: "Password123" });
    expect(r2.status).toBe(400);

    const r3 = await request(app)
      .post("/api/auth/login")
      .send({ email: "user@example.com", password: 99 });
    expect(r3.status).toBe(400);
  });

  it("POST /auth/register with non-string email returns 400, not 500", async () => {
    const r = await request(app)
      .post("/api/auth/register")
      .send({
        email: 42,
        password: "Password123",
        displayName: "x",
        securityQuestion: SECURITY_QUESTION,
        securityAnswer: "answer",
      });
    expect(r.status).toBe(400);
  });

  it("POST /auth/forgot-password/question with non-string email returns 400, not 500", async () => {
    const r = await request(app)
      .post("/api/auth/forgot-password/question")
      .send({ email: 1 });
    expect(r.status).toBe(400);
  });

  it("POST /auth/forgot-password/verify with non-string fields returns 400, not 500", async () => {
    const r = await request(app)
      .post("/api/auth/forgot-password/verify")
      .send({ email: {}, securityAnswer: 12 });
    expect(r.status).toBe(400);
  });

  it("POST /auth/forgot-password/reset with non-string fields returns 400, not 500", async () => {
    const r = await request(app)
      .post("/api/auth/forgot-password/reset")
      .send({ resetToken: 1, newPassword: 2 });
    expect(r.status).toBe(400);
  });

  it("PATCH /auth/password with non-string fields returns 400, not 500", async () => {
    const u = await createUser();

    const r1 = await request(app)
      .patch("/api/auth/password")
      .set("Authorization", `Bearer ${u.token}`)
      .send({ currentPassword: 12345, newPassword: "Brandnew1" });
    expect(r1.status).toBe(400);
    expect(typeof r1.body.error).toBe("string");

    const r2 = await request(app)
      .patch("/api/auth/password")
      .set("Authorization", `Bearer ${u.token}`)
      .send({ currentPassword: PASSWORD, newPassword: 99 });
    expect(r2.status).toBe(400);

    const r3 = await request(app)
      .patch("/api/auth/password")
      .set("Authorization", `Bearer ${u.token}`)
      .send({ currentPassword: PASSWORD, newPassword: { foo: "bar" } });
    expect(r3.status).toBe(400);

    const r4 = await request(app)
      .patch("/api/auth/password")
      .set("Authorization", `Bearer ${u.token}`)
      .send({ currentPassword: PASSWORD, newPassword: "short" });
    expect(r4.status).toBe(400);
  });

  it("PATCH /auth/security-question with non-string fields returns 400, not 500", async () => {
    const u = await createUser();

    const r1 = await request(app)
      .patch("/api/auth/security-question")
      .set("Authorization", `Bearer ${u.token}`)
      .send({
        currentPassword: 1,
        securityQuestion: SECURITY_QUESTION,
        securityAnswer: "answer",
      });
    expect(r1.status).toBe(400);
    expect(typeof r1.body.error).toBe("string");

    const r2 = await request(app)
      .patch("/api/auth/security-question")
      .set("Authorization", `Bearer ${u.token}`)
      .send({
        currentPassword: PASSWORD,
        securityQuestion: 42,
        securityAnswer: "answer",
      });
    expect(r2.status).toBe(400);

    const r3 = await request(app)
      .patch("/api/auth/security-question")
      .set("Authorization", `Bearer ${u.token}`)
      .send({
        currentPassword: PASSWORD,
        securityQuestion: SECURITY_QUESTION,
        securityAnswer: { foo: "bar" },
      });
    expect(r3.status).toBe(400);

    const r4 = await request(app)
      .patch("/api/auth/security-question")
      .set("Authorization", `Bearer ${u.token}`)
      .send({
        currentPassword: PASSWORD,
        securityQuestion: "Pertanyaan tidak ada di daftar",
        securityAnswer: "answer",
      });
    expect(r4.status).toBe(400);
  });
});

describe("Google OAuth login/registration", () => {
  const ENV_KEYS = [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "PUBLIC_BASE_URL",
    "GOOGLE_NATIVE_ALLOWED_CLIENT_IDS",
  ] as const;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    process.env["GOOGLE_CLIENT_ID"] = "test-client-id.apps.googleusercontent.com";
    process.env["GOOGLE_CLIENT_SECRET"] = "test-client-secret";
    process.env["PUBLIC_BASE_URL"] = "http://localhost:5173";
    process.env["GOOGLE_NATIVE_ALLOWED_CLIENT_IDS"] =
      "android.apps.googleusercontent.com,ios.apps.googleusercontent.com";
  });

  afterAll(() => {
    for (const k of ENV_KEYS) {
      const v = savedEnv[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  beforeEach(() => {
    mockExchange.mockReset();
    mockVerifyIdToken.mockReset();
  });

  function googleEmail(tag: string): string {
    return `${EMAIL_PREFIX}-g-${tag}-${randomBytes(4).toString("hex")}@example.test`;
  }

  it("GET /auth/google returns 503 when the client id is not configured", async () => {
    const saved = process.env["GOOGLE_CLIENT_ID"];
    delete process.env["GOOGLE_CLIENT_ID"];
    try {
      const res = await request(app).get("/api/auth/google");
      expect(res.status).toBe(503);
    } finally {
      process.env["GOOGLE_CLIENT_ID"] = saved;
    }
  });

  it("GET /auth/google redirects to Google's consent screen and sets a state cookie", async () => {
    const res = await request(app).get("/api/auth/google");
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toContain("accounts.google.com");
    expect(res.headers["location"]).toContain(
      encodeURIComponent("http://localhost:5173/api/auth/google/callback"),
    );
    const setCookie = String(res.headers["set-cookie"] ?? "");
    expect(setCookie).toContain("g_oauth_state=");
  });

  it("callback with a mismatched state redirects to /login?error=google", async () => {
    const res = await request(app)
      .get("/api/auth/google/callback?code=abc&state=WRONG")
      .set("Cookie", "g_oauth_state=RIGHT");
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/login?error=google");
    expect(mockExchange).not.toHaveBeenCalled();
  });

  it("callback with an unverified Google email redirects to /login?error=google_unverified", async () => {
    mockExchange.mockResolvedValue({
      googleId: `g-${randomBytes(6).toString("hex")}`,
      email: googleEmail("unverified"),
      emailVerified: false,
      name: "Unverified User",
      picture: null,
    });
    const res = await request(app)
      .get("/api/auth/google/callback?code=abc&state=S1")
      .set("Cookie", "g_oauth_state=S1");
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/login?error=google_unverified");
  });

  it("callback for a brand-new Google user creates the account and sets a session cookie", async () => {
    const email = googleEmail("new");
    const googleId = `g-${randomBytes(8).toString("hex")}`;
    mockExchange.mockResolvedValue({
      googleId,
      email,
      emailVerified: true,
      name: "New Google User",
      picture: "https://example.test/p.png",
    });

    const res = await request(app)
      .get("/api/auth/google/callback?code=abc&state=S2")
      .set("Cookie", "g_oauth_state=S2");

    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/dashboard");
    expect(String(res.headers["set-cookie"] ?? "")).toContain("session_token=");

    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    expect(row).toBeDefined();
    seededIds.push(row.id);
    expect(row.googleId).toBe(googleId);
    expect(row.passwordHash).toBeNull();
    expect(row.securityAnswerHash).toBeNull();
    expect(row.displayName).toBe("New Google User");

    const sess = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, row.id));
    expect(sess.length).toBeGreaterThan(0);
  });

  it("callback links Google to an existing password account with the same verified email", async () => {
    const existing = await createUser();
    const googleId = `g-${randomBytes(8).toString("hex")}`;
    mockExchange.mockResolvedValue({
      googleId,
      email: existing.email,
      emailVerified: true,
      name: "Linked User",
      picture: null,
    });

    const before = await db
      .select({ c: users.id })
      .from(users)
      .where(like(users.email, `${EMAIL_PREFIX}%`));

    const res = await request(app)
      .get("/api/auth/google/callback?code=abc&state=S3")
      .set("Cookie", "g_oauth_state=S3");
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/dashboard");

    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.id, existing.id))
      .limit(1);
    expect(row.googleId).toBe(googleId);
    // password + security answer are untouched on a link
    expect(row.passwordHash).not.toBeNull();

    const after = await db
      .select({ c: users.id })
      .from(users)
      .where(like(users.email, `${EMAIL_PREFIX}%`));
    expect(after.length).toBe(before.length); // no new user row
  });

  it("password login is refused for a Google-only account", async () => {
    const email = googleEmail("nopw");
    const [row] = await db
      .insert(users)
      .values({
        email,
        googleId: `g-${randomBytes(8).toString("hex")}`,
        displayName: "Google Only",
        selectedMode: "pro",
      })
      .returning();
    seededIds.push(row.id);

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email, password: "whatever123" });
    expect(res.status).toBe(401);
    expect(String(res.body.error)).toContain("Google");
  });

  // ---- Native Google Sign-In -------------------------------------------

  function googleProfile(over: Partial<{ googleId: string; email: string }> = {}) {
    return {
      googleId: over.googleId ?? `g-${randomBytes(8).toString("hex")}`,
      email: over.email ?? googleEmail("native"),
      emailVerified: true as const,
      name: "Native User",
      picture: null,
    };
  }

  it("POST /auth/google/native returns 503 when no native client ids are configured", async () => {
    const saved = process.env["GOOGLE_NATIVE_ALLOWED_CLIENT_IDS"];
    const savedWeb = process.env["GOOGLE_CLIENT_ID"];
    delete process.env["GOOGLE_NATIVE_ALLOWED_CLIENT_IDS"];
    delete process.env["GOOGLE_CLIENT_ID"];
    try {
      const res = await request(app)
        .post("/api/auth/google/native")
        .send({ idToken: "x" });
      expect(res.status).toBe(503);
    } finally {
      process.env["GOOGLE_NATIVE_ALLOWED_CLIENT_IDS"] = saved;
      process.env["GOOGLE_CLIENT_ID"] = savedWeb;
    }
  });

  it("POST /auth/google/native: valid ID token creates a new account and returns {user, token}", async () => {
    const profile = googleProfile();
    mockVerifyIdToken.mockResolvedValue(profile);

    const res = await request(app)
      .post("/api/auth/google/native")
      .send({ idToken: "valid-token" });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.user.email).toBe(profile.email);
    expect(res.body.user.hasPassword).toBe(false);
    expect(typeof res.body.user.createdAt).toBe("string");
    // The token must be a real TradePilot session, not the Google token.
    expect(res.body.token).not.toBe("valid-token");

    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.email, profile.email))
      .limit(1);
    seededIds.push(row.id);
    expect(row.googleId).toBe(profile.googleId);
    expect(row.passwordHash).toBeNull();

    const sess = await db
      .select()
      .from(sessions)
      .where(eq(sessions.token, res.body.token));
    expect(sess.length).toBe(1);
  });

  it("POST /auth/google/native: same google_id on a later call reuses the same account", async () => {
    const profile = googleProfile();
    mockVerifyIdToken.mockResolvedValue(profile);

    const first = await request(app)
      .post("/api/auth/google/native")
      .send({ idToken: "t1" });
    const second = await request(app)
      .post("/api/auth/google/native")
      .send({ idToken: "t2" });

    expect(first.body.user.id).toBe(second.body.user.id);
    seededIds.push(first.body.user.id);
    const rows = await db
      .select({ c: users.id })
      .from(users)
      .where(eq(users.email, profile.email));
    expect(rows.length).toBe(1);
  });

  it("POST /auth/google/native: links a verified email onto an existing password account", async () => {
    const existing = await createUser();
    mockVerifyIdToken.mockResolvedValue(
      googleProfile({ email: existing.email }),
    );

    const res = await request(app)
      .post("/api/auth/google/native")
      .send({ idToken: "link-token" });
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(existing.id);
    expect(res.body.user.hasPassword).toBe(true);

    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.id, existing.id))
      .limit(1);
    expect(row.googleId).not.toBeNull();
    expect(row.passwordHash).not.toBeNull();
  });

  it("POST /auth/google/native: a verified email already linked to a different google_id -> 409", async () => {
    const email = googleEmail("conflict");
    const [row] = await db
      .insert(users)
      .values({
        email,
        googleId: `g-original-${randomBytes(6).toString("hex")}`,
        displayName: "Owned",
        selectedMode: "pro",
      })
      .returning();
    seededIds.push(row.id);

    mockVerifyIdToken.mockResolvedValue(
      googleProfile({ email, googleId: `g-attacker-${randomBytes(6).toString("hex")}` }),
    );
    const res = await request(app)
      .post("/api/auth/google/native")
      .send({ idToken: "attacker-token" });
    expect(res.status).toBe(409);
  });

  it("POST /auth/google/native: a token that fails verification -> 401 (and never logs the token)", async () => {
    mockVerifyIdToken.mockRejectedValue(new Error("Wrong recipient"));
    const res = await request(app)
      .post("/api/auth/google/native")
      .send({ idToken: "bad-audience-token" });
    expect(res.status).toBe(401);
  });

  it("POST /auth/google/native: unknown body fields -> 400", async () => {
    const res = await request(app)
      .post("/api/auth/google/native")
      .send({ idToken: "x", email: "spoof@example.test" });
    expect(res.status).toBe(400);
  });

  // ---- Re-authentication + Google-only account deletion ---------------

  async function googleOnlyUser(): Promise<{ id: number; email: string; token: string; googleId: string }> {
    const email = googleEmail("google-only");
    const googleId = `g-${randomBytes(10).toString("hex")}`;
    const [row] = await db
      .insert(users)
      .values({ email, googleId, displayName: "GO User", selectedMode: "pro" })
      .returning();
    const token = `native-sess-${randomBytes(10).toString("hex")}`;
    await db.insert(sessions).values({
      userId: row.id,
      token,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    seededIds.push(row.id);
    return { id: row.id, email, token, googleId };
  }

  it("POST /auth/reauth/google: a fresh matching ID token returns a short-lived reauthToken", async () => {
    const u = await googleOnlyUser();
    mockVerifyIdToken.mockResolvedValue(
      googleProfile({ email: u.email, googleId: u.googleId }),
    );

    const res = await request(app)
      .post("/api/auth/reauth/google")
      .set("Authorization", `Bearer ${u.token}`)
      .send({ idToken: "fresh-token" });

    expect(res.status).toBe(200);
    expect(typeof res.body.reauthToken).toBe("string");
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(res.body.expiresAt).getTime()).toBeLessThan(
      Date.now() + 6 * 60 * 1000,
    );

    const stored = await db
      .select()
      .from(reauthTokens)
      .where(eq(reauthTokens.userId, u.id));
    expect(stored.length).toBe(1);
    // never stored in the clear
    expect(stored[0]!.tokenHash).not.toBe(res.body.reauthToken);
    expect(stored[0]!.purpose).toBe("delete_account");
  });

  it("POST /auth/reauth/google: a token for a different Google identity -> 401", async () => {
    const u = await googleOnlyUser();
    mockVerifyIdToken.mockResolvedValue(
      googleProfile({ email: `someone-else-${randomBytes(4).toString("hex")}@example.test` }),
    );
    const res = await request(app)
      .post("/api/auth/reauth/google")
      .set("Authorization", `Bearer ${u.token}`)
      .send({ idToken: "mismatched-token" });
    expect(res.status).toBe(401);
  });

  it("POST /auth/reauth/google: requires auth", async () => {
    const res = await request(app)
      .post("/api/auth/reauth/google")
      .send({ idToken: "x" });
    expect(res.status).toBe(401);
  });

  it("DELETE /auth/account: a Google-only account cannot be deleted without a fresh reauth", async () => {
    const u = await googleOnlyUser();
    const res = await request(app)
      .delete("/api/auth/account")
      .set("Authorization", `Bearer ${u.token}`)
      .send({});
    expect(res.status).toBe(400);

    const stillThere = await db.select().from(users).where(eq(users.id, u.id));
    expect(stillThere.length).toBe(1);
  });

  it("DELETE /auth/account: an invalid/expired/used reauthToken -> 401", async () => {
    const u = await googleOnlyUser();
    const res = await request(app)
      .delete("/api/auth/account")
      .set("Authorization", `Bearer ${u.token}`)
      .send({ reauthToken: "not-a-real-token" });
    expect(res.status).toBe(401);
  });

  it("DELETE /auth/account: succeeds with a valid single-use reauthToken (and the token can't be reused)", async () => {
    const u = await googleOnlyUser();
    mockVerifyIdToken.mockResolvedValue(
      googleProfile({ email: u.email, googleId: u.googleId }),
    );
    const reauth = await request(app)
      .post("/api/auth/reauth/google")
      .set("Authorization", `Bearer ${u.token}`)
      .send({ idToken: "fresh" });
    const reauthToken = reauth.body.reauthToken as string;

    const del = await request(app)
      .delete("/api/auth/account")
      .set("Authorization", `Bearer ${u.token}`)
      .send({ reauthToken });
    expect(del.status).toBe(200);

    const gone = await db.select().from(users).where(eq(users.id, u.id));
    expect(gone.length).toBe(0);
    // token is single-use (and the cascade deleted it with the user anyway)
    const leftover = await db
      .select()
      .from(reauthTokens)
      .where(eq(reauthTokens.userId, u.id));
    expect(leftover.length).toBe(0);
  });

  it("DELETE /auth/account: a password account still deletes with the right password (unchanged)", async () => {
    const u = await createUser();
    const res = await request(app)
      .delete("/api/auth/account")
      .set("Authorization", `Bearer ${u.token}`)
      .send({ currentPassword: PASSWORD });
    expect(res.status).toBe(200);
    const gone = await db.select().from(users).where(eq(users.id, u.id));
    expect(gone.length).toBe(0);
  });

  it("GET /auth/me includes hasPassword", async () => {
    const pwUser = await createUser();
    const meP = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${pwUser.token}`);
    expect(meP.body.hasPassword).toBe(true);

    const goUser = await googleOnlyUser();
    const meG = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${goUser.token}`);
    expect(meG.body.hasPassword).toBe(false);
  });
});

describe("Sign in with Apple (native)", () => {
  const ENV_KEYS = [
    "APPLE_TEAM_ID",
    "APPLE_KEY_ID",
    "APPLE_PRIVATE_KEY",
    "APPLE_ALLOWED_CLIENT_IDS",
    "APPLE_NATIVE_CLIENT_ID",
  ] as const;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    process.env["APPLE_TEAM_ID"] = "TESTTEAMID1";
    process.env["APPLE_KEY_ID"] = "TESTKEYID12";
    // Never a real key — verifyAppleIdentityToken/exchangeAppleAuthorizationCode
    // are both mocked in this suite, so this value is never actually used to
    // sign anything. It only needs to be non-empty for isNativeAppleConfigured().
    process.env["APPLE_PRIVATE_KEY"] = "test-not-a-real-key";
    process.env["APPLE_ALLOWED_CLIENT_IDS"] = "id.tradepilot.app";
    delete process.env["APPLE_NATIVE_CLIENT_ID"];
  });

  afterAll(() => {
    for (const k of ENV_KEYS) {
      const v = savedEnv[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  beforeEach(() => {
    mockVerifyAppleToken.mockReset();
    mockExchangeAppleCode.mockReset();
    mockExchangeAppleCode.mockResolvedValue(undefined);
  });

  function appleEmail(tag: string): string {
    return `${EMAIL_PREFIX}-a-${tag}-${randomBytes(4).toString("hex")}@example.test`;
  }

  function appleProfile(
    over: Partial<{ appleId: string; email: string | null; emailVerified: boolean }> = {},
  ) {
    const email = over.email === undefined ? appleEmail("native") : over.email;
    return {
      appleId: over.appleId ?? `a-${randomBytes(8).toString("hex")}`,
      email,
      emailVerified: email ? (over.emailVerified ?? true) : false,
      audience: "id.tradepilot.app",
    };
  }

  const VALID_NATIVE_BODY = {
    identityToken: "identity-token",
    authorizationCode: "auth-code",
    nonce: "raw-nonce",
  };

  it("POST /auth/apple/native returns 503 when Apple config is incomplete", async () => {
    const saved = process.env["APPLE_PRIVATE_KEY"];
    delete process.env["APPLE_PRIVATE_KEY"];
    try {
      const res = await request(app)
        .post("/api/auth/apple/native")
        .send(VALID_NATIVE_BODY);
      expect(res.status).toBe(503);
    } finally {
      process.env["APPLE_PRIVATE_KEY"] = saved;
    }
  });

  it("POST /auth/apple/native: valid token creates a new Apple account and returns {user, token}", async () => {
    const profile = appleProfile();
    mockVerifyAppleToken.mockResolvedValue(profile);

    const res = await request(app)
      .post("/api/auth/apple/native")
      .send(VALID_NATIVE_BODY);

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.user.email).toBe(profile.email);
    expect(res.body.user.hasPassword).toBe(false);
    expect(typeof res.body.user.createdAt).toBe("string");
    // The token must be a real TradePilot session, not the Apple token.
    expect(res.body.token).not.toBe(VALID_NATIVE_BODY.identityToken);
    // Never echoes back anything Apple-specific.
    expect(res.body.identityToken).toBeUndefined();
    expect(res.body.authorizationCode).toBeUndefined();

    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.email, profile.email!))
      .limit(1);
    seededIds.push(row.id);
    expect(row.appleId).toBe(profile.appleId);
    expect(row.passwordHash).toBeNull();

    expect(mockExchangeAppleCode).toHaveBeenCalledWith(
      VALID_NATIVE_BODY.authorizationCode,
      profile.audience,
    );

    const sess = await db
      .select()
      .from(sessions)
      .where(eq(sessions.token, res.body.token));
    expect(sess.length).toBe(1);
  });

  it("POST /auth/apple/native: same sub on a later call reuses the same account", async () => {
    const profile = appleProfile();
    mockVerifyAppleToken.mockResolvedValue(profile);

    const first = await request(app)
      .post("/api/auth/apple/native")
      .send(VALID_NATIVE_BODY);
    const second = await request(app)
      .post("/api/auth/apple/native")
      .send(VALID_NATIVE_BODY);

    expect(first.body.user.id).toBe(second.body.user.id);
    seededIds.push(first.body.user.id);
    const rows = await db
      .select({ c: users.id })
      .from(users)
      .where(eq(users.email, profile.email!));
    expect(rows.length).toBe(1);
  });

  it("POST /auth/apple/native: a later login with no name/email still succeeds on sub alone", async () => {
    const profile = appleProfile();
    mockVerifyAppleToken.mockResolvedValue(profile);
    const first = await request(app)
      .post("/api/auth/apple/native")
      .send(VALID_NATIVE_BODY);
    seededIds.push(first.body.user.id);

    // Apple only guarantees email/name on the first authorization — a
    // returning sign-in can omit both, but `sub` (appleId) is stable.
    mockVerifyAppleToken.mockResolvedValue(
      appleProfile({ appleId: profile.appleId, email: null }),
    );
    const second = await request(app)
      .post("/api/auth/apple/native")
      .send(VALID_NATIVE_BODY);

    expect(second.status).toBe(200);
    expect(second.body.user.id).toBe(first.body.user.id);
    expect(second.body.user.email).toBe(profile.email);
  });

  it("POST /auth/apple/native: links a verified email onto an existing password account", async () => {
    const existing = await createUser();
    mockVerifyAppleToken.mockResolvedValue(
      appleProfile({ email: existing.email }),
    );

    const res = await request(app)
      .post("/api/auth/apple/native")
      .send(VALID_NATIVE_BODY);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(existing.id);
    expect(res.body.user.hasPassword).toBe(true);

    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.id, existing.id))
      .limit(1);
    expect(row.appleId).not.toBeNull();
    expect(row.passwordHash).not.toBeNull();
  });

  it("POST /auth/apple/native: a verified email already linked to a different Apple sub -> 409", async () => {
    const email = appleEmail("conflict");
    const [row] = await db
      .insert(users)
      .values({
        email,
        appleId: `a-original-${randomBytes(6).toString("hex")}`,
        displayName: "Owned",
        selectedMode: "pro",
      })
      .returning();
    seededIds.push(row.id);

    mockVerifyAppleToken.mockResolvedValue(
      appleProfile({ email, appleId: `a-attacker-${randomBytes(6).toString("hex")}` }),
    );
    const res = await request(app)
      .post("/api/auth/apple/native")
      .send(VALID_NATIVE_BODY);
    expect(res.status).toBe(409);

    // The original account must not have been taken over.
    const [unchanged] = await db.select().from(users).where(eq(users.id, row.id));
    expect(unchanged!.appleId).toBe(row.appleId);
  });

  it("POST /auth/apple/native: parallel first-time requests for the same sub create exactly one account", async () => {
    const profile = appleProfile();
    mockVerifyAppleToken.mockResolvedValue(profile);

    const [first, second] = await Promise.all([
      request(app).post("/api/auth/apple/native").send(VALID_NATIVE_BODY),
      request(app).post("/api/auth/apple/native").send(VALID_NATIVE_BODY),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.user.id).toBe(second.body.user.id);

    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, profile.email!));
    expect(rows.length).toBe(1);
    seededIds.push(rows[0]!.id);
  });

  it("POST /auth/apple/native: identity token that fails verification -> 401 (and never logs it)", async () => {
    mockVerifyAppleToken.mockRejectedValue(new Error("signature verification failed"));
    const res = await request(app)
      .post("/api/auth/apple/native")
      .send(VALID_NATIVE_BODY);
    expect(res.status).toBe(401);
  });

  it("POST /auth/apple/native: wrong issuer -> 401", async () => {
    mockVerifyAppleToken.mockRejectedValue(new Error("unexpected \"iss\" claim value"));
    const res = await request(app)
      .post("/api/auth/apple/native")
      .send(VALID_NATIVE_BODY);
    expect(res.status).toBe(401);
  });

  it("POST /auth/apple/native: wrong audience -> 401", async () => {
    mockVerifyAppleToken.mockRejectedValue(new Error("unexpected \"aud\" claim value"));
    const res = await request(app)
      .post("/api/auth/apple/native")
      .send(VALID_NATIVE_BODY);
    expect(res.status).toBe(401);
  });

  it("POST /auth/apple/native: expired token -> 401", async () => {
    mockVerifyAppleToken.mockRejectedValue(new Error('"exp" claim timestamp check failed'));
    const res = await request(app)
      .post("/api/auth/apple/native")
      .send(VALID_NATIVE_BODY);
    expect(res.status).toBe(401);
  });

  it("POST /auth/apple/native: wrong nonce -> 401", async () => {
    mockVerifyAppleToken.mockRejectedValue(new Error("Apple identity token nonce mismatch"));
    const res = await request(app)
      .post("/api/auth/apple/native")
      .send(VALID_NATIVE_BODY);
    expect(res.status).toBe(401);
  });

  it("POST /auth/apple/native: missing nonce field -> 400 (schema rejects before verification runs)", async () => {
    const { nonce: _omit, ...rest } = VALID_NATIVE_BODY;
    void _omit;
    const res = await request(app).post("/api/auth/apple/native").send(rest);
    expect(res.status).toBe(400);
    expect(mockVerifyAppleToken).not.toHaveBeenCalled();
  });

  it("POST /auth/apple/native: invalid/reused authorization code -> 401", async () => {
    mockVerifyAppleToken.mockResolvedValue(appleProfile());
    mockExchangeAppleCode.mockRejectedValue(new Error("Apple token endpoint returned 400"));
    const res = await request(app)
      .post("/api/auth/apple/native")
      .send(VALID_NATIVE_BODY);
    expect(res.status).toBe(401);
  });

  it("POST /auth/apple/native: email present but email_verified=false -> 401 (rejected during verification)", async () => {
    mockVerifyAppleToken.mockRejectedValue(new Error("Apple account email is not verified"));
    const res = await request(app)
      .post("/api/auth/apple/native")
      .send(VALID_NATIVE_BODY);
    expect(res.status).toBe(401);
  });

  it("POST /auth/apple/native: unknown body fields -> 400", async () => {
    const res = await request(app)
      .post("/api/auth/apple/native")
      .send({ ...VALID_NATIVE_BODY, email: "spoof@example.test" });
    expect(res.status).toBe(400);
    expect(mockVerifyAppleToken).not.toHaveBeenCalled();
  });

  it("POST /auth/apple/native: givenName/familyName only seed the display name on a brand-new account", async () => {
    const profile = appleProfile();
    mockVerifyAppleToken.mockResolvedValue(profile);

    const res = await request(app)
      .post("/api/auth/apple/native")
      .send({ ...VALID_NATIVE_BODY, givenName: "  Ada  ", familyName: "Lovelace" });
    expect(res.status).toBe(200);
    expect(res.body.user.displayName).toBe("Ada Lovelace");
    seededIds.push(res.body.user.id);

    // A later login with a different (or missing) name must NOT overwrite
    // the display name the account already has.
    mockVerifyAppleToken.mockResolvedValue(
      appleProfile({ appleId: profile.appleId, email: null }),
    );
    const again = await request(app)
      .post("/api/auth/apple/native")
      .send({ ...VALID_NATIVE_BODY, givenName: "Someone", familyName: "Else" });
    expect(again.status).toBe(200);
    expect(again.body.user.displayName).toBe("Ada Lovelace");
  });

  it("POST /auth/apple/native: rate limit yields 429 with Retry-After", async () => {
    const profile = appleProfile();
    mockVerifyAppleToken.mockResolvedValue(profile);
    let last: request.Response | undefined;
    for (let i = 0; i < 21; i++) {
      last = await request(app).post("/api/auth/apple/native").send(VALID_NATIVE_BODY);
    }
    expect(last!.status).toBe(429);
    expect(last!.headers["retry-after"]).toBeDefined();
    const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, profile.email!));
    if (row) seededIds.push(row.id);
  });

  // ---- Re-authentication + Apple-only account deletion --------------------

  async function appleOnlyUser(): Promise<{ id: number; email: string; token: string; appleId: string }> {
    const email = appleEmail("apple-only");
    const appleId = `a-${randomBytes(10).toString("hex")}`;
    const [row] = await db
      .insert(users)
      .values({ email, appleId, displayName: "AO User", selectedMode: "pro" })
      .returning();
    const token = `native-apple-sess-${randomBytes(10).toString("hex")}`;
    await db.insert(sessions).values({
      userId: row.id,
      token,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    seededIds.push(row.id);
    return { id: row.id, email, token, appleId };
  }

  it("POST /auth/reauth/apple: a fresh matching identity token returns a short-lived reauthToken", async () => {
    const u = await appleOnlyUser();
    mockVerifyAppleToken.mockResolvedValue(
      appleProfile({ email: u.email, appleId: u.appleId }),
    );

    const res = await request(app)
      .post("/api/auth/reauth/apple")
      .set("Authorization", `Bearer ${u.token}`)
      .send(VALID_NATIVE_BODY);

    expect(res.status).toBe(200);
    expect(typeof res.body.reauthToken).toBe("string");
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(res.body.expiresAt).getTime()).toBeLessThan(
      Date.now() + 6 * 60 * 1000,
    );

    const stored = await db
      .select()
      .from(reauthTokens)
      .where(eq(reauthTokens.userId, u.id));
    expect(stored.length).toBe(1);
    expect(stored[0]!.tokenHash).not.toBe(res.body.reauthToken);
    expect(stored[0]!.purpose).toBe("delete_account");
  });

  it("POST /auth/reauth/apple: a token for a different Apple identity -> 401", async () => {
    const u = await appleOnlyUser();
    mockVerifyAppleToken.mockResolvedValue(
      appleProfile({ appleId: `a-someone-else-${randomBytes(4).toString("hex")}` }),
    );
    const res = await request(app)
      .post("/api/auth/reauth/apple")
      .set("Authorization", `Bearer ${u.token}`)
      .send(VALID_NATIVE_BODY);
    expect(res.status).toBe(401);
  });

  it("POST /auth/reauth/apple: a Google-only account's reauth token cannot be reused here / this route requires auth", async () => {
    const res = await request(app)
      .post("/api/auth/reauth/apple")
      .send(VALID_NATIVE_BODY);
    expect(res.status).toBe(401);
  });

  it("DELETE /auth/account: an Apple-only account cannot be deleted without a fresh reauth", async () => {
    const u = await appleOnlyUser();
    const res = await request(app)
      .delete("/api/auth/account")
      .set("Authorization", `Bearer ${u.token}`)
      .send({});
    expect(res.status).toBe(400);

    const stillThere = await db.select().from(users).where(eq(users.id, u.id));
    expect(stillThere.length).toBe(1);
  });

  it("DELETE /auth/account: succeeds with a valid single-use Apple reauthToken (and it can't be reused, and apple_id is gone with the row)", async () => {
    const u = await appleOnlyUser();
    mockVerifyAppleToken.mockResolvedValue(
      appleProfile({ email: u.email, appleId: u.appleId }),
    );
    const reauth = await request(app)
      .post("/api/auth/reauth/apple")
      .set("Authorization", `Bearer ${u.token}`)
      .send(VALID_NATIVE_BODY);
    const reauthToken = reauth.body.reauthToken as string;

    const del = await request(app)
      .delete("/api/auth/account")
      .set("Authorization", `Bearer ${u.token}`)
      .send({ reauthToken });
    expect(del.status).toBe(200);

    const gone = await db.select().from(users).where(eq(users.id, u.id));
    expect(gone.length).toBe(0);
    const leftover = await db
      .select()
      .from(reauthTokens)
      .where(eq(reauthTokens.userId, u.id));
    expect(leftover.length).toBe(0);

    // Reusing the same (already-consumed) reauthToken must fail even for a
    // brand-new account — it's tied to the deleted user's id.
    const reuse = await request(app)
      .delete("/api/auth/account")
      .set("Authorization", `Bearer ${u.token}`)
      .send({ reauthToken });
    expect(reuse.status).toBe(401);
  });

  it("no Apple credential (token, nonce, authorization code, or private key) ever appears in a response body", async () => {
    const profile = appleProfile();
    mockVerifyAppleToken.mockResolvedValue(profile);
    const res = await request(app)
      .post("/api/auth/apple/native")
      .send(VALID_NATIVE_BODY);
    seededIds.push(res.body.user.id);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(VALID_NATIVE_BODY.identityToken);
    expect(serialized).not.toContain(VALID_NATIVE_BODY.authorizationCode);
    expect(serialized).not.toContain(VALID_NATIVE_BODY.nonce);
    expect(serialized).not.toContain(process.env["APPLE_PRIVATE_KEY"]!);
  });
});
