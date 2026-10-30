/**
 * Konsol admin TradePilot v1: halaman Ringkasan, Audit analisis, dan Pengguna
 * merender data dari /api/admin/trade-pilot/*.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { maskEmail } from "@/lib/tp-admin-api";

import TpAdminOverviewPage from "../tp-admin/overview";
import TpAdminAnalysesPage from "../tp-admin/analyses";
import TpAdminUsersPage from "../tp-admin/users";
import TpAdminUserDetailPage from "../tp-admin/user-detail";
import TpAdminAuditPage from "../tp-admin/audit";
import TpAdminStaffPage from "../tp-admin/staff";
import TpAdminQuotaSettingsPage from "../tp-admin/quota-settings";
import TpAdminHealthPage from "../tp-admin/health";
import { installFetchMock, jsonResponse, makeWrapper, TEST_USER } from "./test-helpers";

const USER_ID = "3f1c9a".padEnd(64, "0");

// Teks yang dicek di test ini berbahasa Indonesia; bahasa default aplikasi
// adalah Inggris bila localStorage kosong, jadi kunci bahasa per test.
beforeEach(() => {
  window.localStorage.setItem("app_lang", "id");
});
afterEach(() => {
  window.localStorage.removeItem("app_lang");
});

const asAdmin = (url: string) =>
  url.includes("/api/auth/me") ? jsonResponse({ ...TEST_USER, role: "admin" }) : null;

const OVERVIEW = {
  days: 30,
  users: { total: 42, new24h: 2, newInRange: 9, activeInRange: 17 },
  analyses: {
    total: 120,
    last24h: 8,
    byMode: [{ key: "demo", count: 80 }, { key: "real", count: 40 }],
    byInstrument: [{ key: "XAU/USD", count: 100 }],
    byTimeframe: [{ key: "1h", count: 60 }],
    byStatus: [{ key: "take_profit_2", count: 30 }, { key: "stop_loss", count: 20 }],
    byDirection: [{ key: "neutral", count: 50 }],
  },
  quality: {
    byInstrument: [{ key: "XAU/USD", total: 100, tp: 30, sl: 20, expired: 40, open: 10 }],
    byTimeframe: [{ key: "1h", total: 60, tp: 30, sl: 20, expired: 5, open: 5 }],
    byDirection: [{ key: "neutral", total: 50, tp: 30, sl: 20, expired: 0, open: 0 }],
  },
  ai: { tokens: 50000, costUsd: 1.25, costUsd24h: 0.1, cacheHits: 30, cacheHitRate: 0.25, avgCostPerAnalysisUsd: 0.0104, byModel: [] },
  daily: [{ date: "2026-10-28", analyses: 8, users: 5, costUsd: 0.1, tokens: 3000, cacheHits: 2 }],
  alerts: { active: 3, triggeredInRange: 1 },
  credits: [
    { mode: "demo", allowance: 5, period: "daily", usersInPeriod: 10, consumed: 30, allowanceTotal: 50, exhausted: 2 },
    { mode: "real", allowance: 50, period: "monthly", usersInPeriod: 4, consumed: 40, allowanceTotal: 200, exhausted: 0 },
  ],
  topUsers: [{ userId: USER_ID, analyses: 12, costUsd: 0.2, lastAnalysisAt: "2026-10-28T02:00:00.000Z" }],
};

function renderPage(node: React.ReactNode) {
  const { Wrapper } = makeWrapper();
  return render(<Wrapper>{node}</Wrapper>);
}

describe("TradePilot admin console", () => {
  it("shows overview KPIs", async () => {
    installFetchMock(
      [asAdmin, (url) => (url.includes("/api/admin/trade-pilot/overview") ? jsonResponse(OVERVIEW) : null)],
      { strict: false },
    );
    renderPage(<TpAdminOverviewPage />);
    // Pengguna aktif + total pengguna di keterangan.
    expect(await screen.findByText("17")).toBeInTheDocument();
    expect(screen.getByText("dari 42 pengguna · 9 baru")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText("US$1,25")).toBeInTheDocument();
    // Tingkat TP = 30 / (30 + 20).
    expect(screen.getAllByText("60%").length).toBeGreaterThan(0);
    expect(screen.getByText("2 pengguna kehabisan kredit")).toBeInTheDocument();
  });

  it("shows persisted system health metrics", async () => {
    installFetchMock(
      [
        asAdmin,
        (url) => url.includes("/api/admin/trade-pilot/health")
          ? jsonResponse({
              capturedAt: "2026-10-28T06:00:00.000Z",
              overall: "warning",
              candles: {
                status: "warning",
                observed: 1,
                items: [{
                  instrumentId: "gold",
                  timeframe: "60",
                  status: "warning",
                  checkedAt: "2026-10-28T05:40:00.000Z",
                  lastSuccessAt: "2026-10-28T05:40:00.000Z",
                  lastFailureAt: null,
                  candleAsOf: "2026-10-28T05:00:00.000Z",
                  sourceFetchedAt: "2026-10-28T05:40:00.000Z",
                  sourceMaxAgeMs: 3600000,
                  staleReason: null,
                  observationAgeMs: 1200000,
                }],
              },
              openai: { status: "warning", total: 8, failed: 1, failureRate: 0.125, windowHours: 24, lastSuccessAt: "2026-10-28T05:50:00.000Z", lastFailureAt: "2026-10-28T05:45:00.000Z", checkedAt: "2026-10-28T05:50:00.000Z", details: {} },
              jobs: [
                { key: "signal_evaluation", status: "healthy", lastSuccessAt: "2026-10-28T05:59:00.000Z", lastFailureAt: null, checkedAt: "2026-10-28T05:59:00.000Z", details: { durationMs: 120 } },
                { key: "performance_aggregation", status: "healthy", lastSuccessAt: "2026-10-28T05:50:00.000Z", lastFailureAt: null, checkedAt: "2026-10-28T05:50:00.000Z", details: { durationMs: 300 } },
              ],
              webhook: { configured: true, status: "healthy", total: 4, failed: 0, failureRate: 0, windowHours: 24, lastSuccessAt: "2026-10-28T05:30:00.000Z", lastFailureAt: null, checkedAt: "2026-10-28T05:30:00.000Z", details: {} },
            })
          : null,
      ],
      { strict: false },
    );

    renderPage(<TpAdminHealthPage />);
    expect(await screen.findByText("12,5%")).toBeInTheDocument();
    expect(screen.getByText("Emas · XAU/USD")).toBeInTheDocument();
    expect(screen.getByText("2/2 sehat")).toBeInTheDocument();
  });

  it("lists analyses with a link to the detail page", async () => {
    installFetchMock(
      [
        asAdmin,
        (url) =>
          url.includes("/api/admin/trade-pilot/analyses")
            ? jsonResponse({
                page: 1,
                limit: 25,
                total: 1,
                items: [
                  {
                    id: "a_test123456",
                    userId: USER_ID,
                    mode: "real",
                    instrumentId: "gold",
                    instrumentLabel: "XAU/USD",
                    timeframe: "60",
                    timeframeLabel: "1h",
                    direction: "neutral",
                    marketSentiment: "bullish",
                    status: "stop_loss",
                    priceAtAnalysis: "4162.35",
                    analyzedAt: "2026-10-28T02:00:00.000Z",
                    validUntil: "2026-10-28T06:00:00.000Z",
                    resolvedAt: null,
                    model: "gpt-test",
                    aiCacheHit: false,
                    totalTokens: 1234,
                    estimatedCostUsd: 0.0123,
                    requestId: "req_abc",
                  },
                ],
              })
            : null,
      ],
      { strict: false },
    );
    renderPage(<TpAdminAnalysesPage />);
    const idLabel = await screen.findByText("a_test123456");
    const link = idLabel.closest("td")?.querySelector("a");
    expect(link).toHaveAttribute("href", "/admin/analyses/a_test123456");
    expect(screen.getByText("US$0,0123")).toBeInTheDocument();
  });

  it("lists users with credit usage", async () => {
    installFetchMock(
      [
        asAdmin,
        (url) =>
          url.includes("/api/admin/trade-pilot/users")
            ? jsonResponse({
                page: 1,
                limit: 25,
                total: 1,
                items: [
                  {
                    userId: USER_ID,
                    firstSeenMode: "demo",
                    createdAt: "2026-10-20T02:00:00.000Z",
                    bootstrappedAt: "2026-10-20T02:00:00.000Z",
                    analyses: 7,
                    costUsd: 0.07,
                    lastAnalysisAt: "2026-10-28T02:00:00.000Z",
                    activeAlerts: 1,
                    credits: {
                      demo: { mode: "demo", allowance: 5, consumed: 5, remaining: 0, resetsAt: "2026-10-29T00:00:00.000Z", inPeriod: true },
                      real: null,
                    },
                  },
                ],
              })
            : null,
      ],
      { strict: false },
    );
    renderPage(<TpAdminUsersPage />);
    expect(await screen.findByText("5/5")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: `${USER_ID.slice(0, 12)}…` })).toHaveAttribute(
      "href",
      `/admin/users/${USER_ID}`,
    );
  });

  it("looks a user up by email via POST and opens the user page", async () => {
    const { calls } = installFetchMock(
      [
        asAdmin,
        (url, init) =>
          url.includes("/api/admin/trade-pilot/users/lookup") && init?.method === "POST"
            ? jsonResponse({ found: true, userId: USER_ID })
            : null,
        (url) =>
          url.includes("/api/admin/trade-pilot/users")
            ? jsonResponse({ page: 1, limit: 25, total: 0, items: [] })
            : null,
      ],
      { strict: false },
    );
    renderPage(<TpAdminUsersPage />);
    fireEvent.change(await screen.findByPlaceholderText("nasabah@email.com"), {
      target: { value: "Budi@Example.com" },
    });
    fireEvent.submit(screen.getByTestId("form-email-lookup"));

    await waitFor(() => expect(window.location.pathname).toBe(`/admin/users/${USER_ID}`));
    const lookup = calls.find((call) => call.url.includes("/users/lookup"));
    expect(lookup?.method).toBe("POST");
    expect(lookup?.url).not.toContain("Budi");
    expect(JSON.parse(lookup?.body ?? "{}")).toEqual({ email: "Budi@Example.com" });
    expect(window.history.state?.lookupEmail).toBe("Budi@Example.com");
  });

  it("masks emails for display", () => {
    expect(maskEmail("budi.santoso@gmail.com")).toBe("b***o@gmail.com");
    expect(maskEmail("ab@x.id")).toBe("a***@x.id");
  });

  const USER_DETAIL = {
    userId: USER_ID,
    firstSeenMode: "demo",
    createdAt: "2026-10-20T02:00:00.000Z",
    bootstrappedAt: "2026-10-20T02:00:00.000Z",
    credits: [{ mode: "demo", allowance: 5, consumed: 5, remaining: 0, resetsAt: "2026-10-29T00:00:00.000Z", inPeriod: true }],
    statsByMode: [],
    byStatus: [],
    tradingPlans: 0,
    recentAnalyses: [],
    alerts: [],
  };

  function detailHandlers(role: "admin" | "super_admin") {
    return [
      (url: string) => (url.includes("/api/auth/me") ? jsonResponse({ ...TEST_USER, role }) : null),
      (url: string, init?: RequestInit) =>
        url.includes(`/users/${USER_ID}/credits/demo`) && init?.method === "POST"
          ? jsonResponse({ credit: { mode: "demo", allowance: 25, consumed: 5, remaining: 20, resetsAt: "2026-10-29T00:00:00.000Z", inPeriod: true } })
          : null,
      (url: string) => (url.includes(`/api/admin/trade-pilot/users/${USER_ID}`) ? jsonResponse(USER_DETAIL) : null),
    ];
  }

  it("lets a super_admin set remaining credits for a mode", async () => {
    const { calls } = installFetchMock(detailHandlers("super_admin"), { strict: false });
    renderPage(<TpAdminUserDetailPage params={{ userId: USER_ID }} />);

    const input = await screen.findByTestId("input-credit-remaining-demo");
    fireEvent.change(input, { target: { value: "20" } });
    fireEvent.click(screen.getByTestId("button-credit-save-demo"));

    await waitFor(() => {
      const call = calls.find((c) => c.url.includes("/credits/demo") && c.method === "POST");
      expect(call).toBeDefined();
      expect(JSON.parse(call?.body ?? "{}")).toEqual({ action: "set", remaining: 20 });
    });
  });

  it("requires a second click to reset credits", async () => {
    const { calls } = installFetchMock(detailHandlers("super_admin"), { strict: false });
    renderPage(<TpAdminUserDetailPage params={{ userId: USER_ID }} />);

    const reset = await screen.findByTestId("button-credit-reset-demo");
    fireEvent.click(reset);
    expect(calls.some((c) => c.url.includes("/credits/demo"))).toBe(false);
    fireEvent.click(screen.getByTestId("button-credit-reset-demo"));

    await waitFor(() => {
      const call = calls.find((c) => c.url.includes("/credits/demo") && c.method === "POST");
      expect(JSON.parse(call?.body ?? "{}")).toEqual({ action: "reset" });
    });
  });

  it("hides credit controls from a regular admin", async () => {
    installFetchMock(detailHandlers("admin"), { strict: false });
    renderPage(<TpAdminUserDetailPage params={{ userId: USER_ID }} />);
    expect(await screen.findByText(USER_ID)).toBeInTheDocument();
    expect(screen.queryByTestId("credit-row-demo")).toBeNull();
  });

  it("lists admin audit events and exposes change details", async () => {
    installFetchMock(
      [
        asAdmin,
        (url) =>
          url.includes("/api/admin/trade-pilot/audit")
            ? jsonResponse({
                page: 1,
                limit: 50,
                total: 1,
                admins: [{ id: 7, email: "ops@example.com", displayName: "Ops Lead" }],
                items: [
                  {
                    id: 101,
                    action: "credit_set",
                    adminUserId: 7,
                    adminEmail: "ops@example.com",
                    adminName: "Ops Lead",
                    adminRole: "super_admin",
                    targetUserId: USER_ID,
                    found: true,
                    requestId: "req_audit_123456789",
                    details: { mode: "real", before: { allowance: 50, consumed: 10 }, after: { allowance: 50, consumed: 30 } },
                    createdAt: "2026-10-28T02:00:00.000Z",
                  },
                ],
              })
            : null,
      ],
      { strict: false },
    );

    renderPage(<TpAdminAuditPage />);

    // Tunggu baris tabel (label aksi juga muncul di dropdown filter sebelum data dimuat).
    expect(await screen.findByText("Ops Lead")).toBeInTheDocument();
    expect(screen.getAllByText("Ubah sisa kredit").length).toBeGreaterThan(1);
    expect(screen.getByRole("link", { name: `${USER_ID.slice(0, 12)}…` })).toHaveAttribute("href", `/admin/users/${USER_ID}`);
    fireEvent.click(screen.getByText("Lihat detail"));
    expect(screen.getByText(/"allowance": 50/)).toBeInTheDocument();
  });

  it("creates staff and requires confirmation before revoking access", async () => {
    const { calls } = installFetchMock(
      [
        (url) => (url.includes("/api/auth/me") ? jsonResponse({ ...TEST_USER, role: "super_admin" }) : null),
        (url, init) => {
          if (!url.includes("/api/admin/trade-pilot/staff")) return null;
          const method = init?.method ?? "GET";
          if (method === "POST" && url.endsWith("/staff")) return jsonResponse({ id: 8, created: true }, 201);
          if (method === "PATCH" && url.endsWith("/staff/7/role")) return jsonResponse({ id: 7, role: "user" });
          if (method === "GET") {
            return jsonResponse({
              items: [
                {
                  id: 7,
                  email: "admin@example.com",
                  displayName: "Admin Lama",
                  role: "admin",
                  createdAt: "2026-10-20T02:00:00.000Z",
                  hasPassword: true,
                  lastSessionAt: "2026-10-28T02:00:00.000Z",
                },
              ],
            });
          }
          return null;
        },
      ],
      { strict: false },
    );

    renderPage(<TpAdminStaffPage />);
    expect(await screen.findByText("Admin Lama")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("admin@perusahaan.com"), { target: { value: "baru@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("Nama admin"), { target: { value: "Admin Baru" } });
    fireEvent.change(screen.getByPlaceholderText("Minimal 8 karakter untuk akun baru"), { target: { value: "password-kuat" } });
    fireEvent.submit(screen.getByTestId("form-staff-create"));

    await waitFor(() => {
      const create = calls.find((call) => call.url.endsWith("/staff") && call.method === "POST");
      expect(JSON.parse(create?.body ?? "{}")).toEqual({
        email: "baru@example.com",
        displayName: "Admin Baru",
        role: "admin",
        password: "password-kuat",
      });
    });

    fireEvent.change(screen.getAllByRole("combobox")[1]!, { target: { value: "user" } });
    const revoke = screen.getByTestId("button-staff-role-7");
    fireEvent.click(revoke);
    expect(calls.some((call) => call.url.endsWith("/staff/7/role") && call.method === "PATCH")).toBe(false);
    fireEvent.click(revoke);

    await waitFor(() => {
      const roleChange = calls.find((call) => call.url.endsWith("/staff/7/role") && call.method === "PATCH");
      expect(JSON.parse(roleChange?.body ?? "{}")).toEqual({ role: "user" });
    });
  });

  it("saves global quota settings after a confirmation step", async () => {
    const settings = {
      quota: {
        current: { demo: { allowance: 5, period: "daily" }, real: { allowance: 50, period: "monthly" } },
        defaults: { demo: { allowance: 5, period: "daily" }, real: { allowance: 50, period: "monthly" } },
        custom: false,
        meta: null,
      },
      availability: {
        current: { enabled: true, modes: {}, instruments: {}, timeframes: {}, message: { id: null, en: null } },
        meta: null,
      },
    };
    const { calls } = installFetchMock(
      [
        (url) => (url.includes("/api/auth/me") ? jsonResponse({ ...TEST_USER, role: "super_admin" }) : null),
        (url, init) => {
          if (url.includes("/api/admin/trade-pilot/settings/quota") && init?.method === "PUT") {
            return jsonResponse({ quota: { demo: { allowance: 10, period: "daily" }, real: { allowance: 50, period: "monthly" } }, applied: { demo: 3 } });
          }
          if (url.includes("/api/admin/trade-pilot/settings") && (init?.method ?? "GET") === "GET") return jsonResponse(settings);
          return null;
        },
      ],
      { strict: false },
    );

    renderPage(<TpAdminQuotaSettingsPage />);
    const demo = await screen.findByTestId("input-quota-demo");
    fireEvent.change(demo, { target: { value: "10" } });
    fireEvent.click(screen.getByText("Terapkan jumlah kuota ke periode berjalan"));

    const save = screen.getByTestId("button-quota-save");
    fireEvent.click(save);
    expect(calls.some((call) => call.url.includes("/settings/quota") && call.method === "PUT")).toBe(false);
    fireEvent.click(save);

    await waitFor(() => {
      const request = calls.find((call) => call.url.includes("/settings/quota") && call.method === "PUT");
      expect(JSON.parse(request?.body ?? "{}")).toEqual({
        demo: { allowance: 10, period: "daily" },
        real: { allowance: 50, period: "monthly" },
        applyToCurrentPeriod: true,
      });
    });
  });

  it("pauses a selected analysis scope after a confirmation step", async () => {
    const settings = {
      quota: {
        current: { demo: { allowance: 5, period: "daily" }, real: { allowance: 50, period: "monthly" } },
        defaults: { demo: { allowance: 5, period: "daily" }, real: { allowance: 50, period: "monthly" } },
        custom: false,
        meta: null,
      },
      availability: {
        current: { enabled: true, modes: {}, instruments: {}, timeframes: {}, message: { id: null, en: null } },
        meta: null,
      },
    };
    const { calls } = installFetchMock(
      [
        (url) => (url.includes("/api/auth/me") ? jsonResponse({ ...TEST_USER, role: "super_admin" }) : null),
        (url, init) => {
          if (url.includes("/api/admin/trade-pilot/settings/availability") && init?.method === "PUT") {
            return jsonResponse({ availability: { ...settings.availability.current, modes: { demo: false } } });
          }
          if (url.includes("/api/admin/trade-pilot/settings") && (init?.method ?? "GET") === "GET") return jsonResponse(settings);
          return null;
        },
      ],
      { strict: false },
    );

    renderPage(<TpAdminQuotaSettingsPage />);
    fireEvent.click(await screen.findByTestId("switch-availability-mode-demo"));
    fireEvent.change(screen.getByTestId("textarea-availability-message-id"), {
      target: { value: "Analisis demo sedang dijeda." },
    });

    const save = screen.getByTestId("button-availability-save");
    fireEvent.click(save);
    expect(calls.some((call) => call.url.includes("/settings/availability") && call.method === "PUT")).toBe(false);
    fireEvent.click(save);

    await waitFor(() => {
      const request = calls.find((call) => call.url.includes("/settings/availability") && call.method === "PUT");
      expect(JSON.parse(request?.body ?? "{}")).toEqual({
        enabled: true,
        modes: { demo: false },
        instruments: {},
        timeframes: {},
        message: { id: "Analisis demo sedang dijeda.", en: null },
      });
    });
  });
});
