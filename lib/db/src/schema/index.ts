import {
  pgTable,
  serial,
  bigserial,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  numeric,
  pgEnum,
  uniqueIndex,
  index,
  foreignKey,
  primaryKey,
} from "drizzle-orm/pg-core";

export type TradeSideShape = {
  entryZone: string;
  stopLoss: string;
  takeProfit1: string;
  takeProfit2: string;
  riskRewardRatio: string;
  rationale: string;
};

export type TradePlanShape = {
  preferredSide: "buy" | "sell" | "wait";
  buy: TradeSideShape;
  sell: TradeSideShape;
};

// Snapshot of the news + economic-calendar items the AI saw at analysis
// time so the saved-analysis page can render the same fundamental
// context the user (and the model) had — without re-fetching live data
// that may have moved on. Captured on the analyses row by the POST
// /api/analyses handler in `routes/analyses.ts`.
export type FundamentalNewsItemShape = {
  id: string;
  title: string;
  summary: string;
  source: string;
  url: string | null;
  publishedAt: string;
};

export type FundamentalCalendarEventShape = {
  date: string;
  time: string | null;
  currency: string;
  event: string;
  impact: string | null;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
};

export type FundamentalContextShape = {
  newsItems: FundamentalNewsItemShape[];
  calendarEvents: FundamentalCalendarEventShape[];
};

// Provenance trail emitted by the AI: which news headlines + calendar
// event names it actually leaned on while writing the narrative. Lets
// the analysis-detail page inline-cite the matching cards next to
// `whyReason` / `keyDriversFundamental` / `marketContext` (task #89).
// Stored alongside `fundamentalContext` so the inline chips can match
// against the same persisted snapshot the AI was given.
export type FundamentalCitationsShape = {
  newsTitles: string[];
  calendarEvents: string[];
};

// Selected-timeframe market data captured when an analysis was generated.
// sourceFetchedAt is null only when the candle feed could not provide bars;
// sourceStatus distinguishes unavailable and stale data from a fresh fetch.
export type MarketSnapshotShape = {
  instrument: string;
  timeframe: string;
  capturedAt: string;
  sourceFetchedAt: string | null;
  candles: Array<{
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
  }>;
  priceAtAnalysis: number | null;
  sourceStatus: string;
};

export const roleEnum = pgEnum("role", ["user", "admin", "super_admin"]);
export const modeEnum = pgEnum("mode", ["beginner", "pro"]);
export const marketConditionEnum = pgEnum("market_condition", [
  "trending_up",
  "trending_down",
  "ranging",
  "volatile",
]);
export const riskLevelEnum = pgEnum("risk_level", ["low", "medium", "high"]);
export const feedbackTypeEnum = pgEnum("feedback_type", [
  "useful",
  "not_useful",
]);
export const outcomeEnum = pgEnum("outcome", ["correct", "wrong", "unknown"]);
// Outcome of the AI's trade plan after the fact — did price actually touch
// TP1 / TP2 / SL within the analysis's validity window? Populated by the
// background resolver in `lib/outcomes.ts`, separate from the user-driven
// `outcomeEnum` above (which lives on the feedback table).
export const analysisOutcomeEnum = pgEnum("analysis_outcome", [
  "pending",
  "tp1_hit",
  "tp2_hit",
  "sl_hit",
  "expired",
  "invalidated",
]);
export const notificationTypeEnum = pgEnum("notification_type", [
  "info",
  "warning",
  "error",
]);
export const audienceTypeEnum = pgEnum("audience_type", [
  "all",
  "role",
  "tag",
]);

// Which AI-generated level a price_alerts row is watching. `entry` is the
// AI's preferred entry zone, `sl` the stop-loss, `tp1` / `tp2` the two
// take-profits. One analysis can arm up to 4 levels per side, but in v1
// we only arm levels for the AI's `preferredSide` (buy or sell), so each
// active analysis has at most 4 rows.
export const alertLevelEnum = pgEnum("alert_level", ["entry", "sl", "tp1", "tp2"]);
// Direction the price needs to cross to fire the alert. Computed at arm
// time from the spot price vs. the level: if spot is above the level,
// we fire `below` (price needs to fall to touch); if spot is below, we
// fire `above`. Stored explicitly so the watcher doesn't have to
// re-derive it (and stays correct even if our derivation logic changes
// later).
export const alertDirectionEnum = pgEnum("alert_direction", ["above", "below"]);

// Allowlisted notification tap-targets (store-readiness: actionable
// notifications). Deliberately a closed enum rather than a free-form URL —
// the client resolves `actionType` + `actionId` to an in-app navigation
// itself, so a compromised/legacy producer can never smuggle an arbitrary
// redirect through a notification payload. Extend this list (with a
// migration) only when a new tap-target is actually wired up end-to-end.
export const notificationActionTypeEnum = pgEnum("notification_action_type", [
  "open_notification",
  "open_analysis",
]);

// Native push device platform (FCM). Kept separate from Web Push, which
// has no platform concept (browser subscriptions are identified purely by
// endpoint/keys).
export const nativePushPlatformEnum = pgEnum("native_push_platform", [
  "android",
  "ios",
]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  // Nullable: accounts created via Google OAuth have no local password
  // (and no security question). Every password/security-question route
  // guards for null before calling bcrypt — see routes/auth.ts.
  passwordHash: text("password_hash"),
  // Google account subject id ("sub" claim). Set when a user signs in
  // with Google — either on first sign-up or when an existing email
  // account links Google. Null for password-only accounts.
  googleId: text("google_id").unique(),
  // Apple account subject id ("sub" claim of a verified Sign in with Apple
  // identity token). Same shape/rules as googleId: set on first Apple
  // sign-in or when an existing email account links Apple; null otherwise.
  // See lib/apple-account.ts for the account-linking rules.
  appleId: text("apple_id").unique(),
  // Facebook account id (Graph API `id`). Same shape/rules as googleId —
  // Facebook's `email` permission returns a Facebook-confirmed address
  // for the account, so this links by email exactly like Google/Apple.
  // See lib/facebook-account.ts.
  facebookId: text("facebook_id").unique(),
  // TikTok account open_id. Unlike Google/Apple, TikTok's Login Kit never
  // returns an email — so a TikTok sign-in can never auto-link to an
  // existing account by email the way Google/Apple do. A brand-new TikTok
  // login always goes through the pendingTiktokSignups flow (collect a
  // real email first) before a user row is created. See
  // lib/tiktok-account.ts.
  tiktokId: text("tiktok_id").unique(),
  // Captured from TikTok's user.info.basic scope at sign-in time — this is
  // the actual product goal of TikTok login (building a base of users'
  // TikTok identities), independent of auth. Refreshed on every login.
  tiktokDisplayName: text("tiktok_display_name"),
  tiktokAvatarUrl: text("tiktok_avatar_url"),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  role: roleEnum("role").notNull().default("user"),
  selectedMode: modeEnum("selected_mode").notNull().default("pro"),
  themePreference: text("theme_preference").notNull().default("light"),
  onboardingCompleted: boolean("onboarding_completed")
    .notNull()
    .default(false),
  // Nullable for the same reason as passwordHash: Google-OAuth accounts
  // never set a security question. The forgot-password flow treats a null
  // hash as "no match" (timing-safe) so these accounts simply can't use
  // security-question recovery.
  securityQuestion: text("security_question"),
  securityAnswerHash: text("security_answer_hash"),
  pushExpiry: boolean("push_expiry").notNull().default(true),
  pushBroadcast: boolean("push_broadcast").notNull().default(true),
  // Daily-summary push (task #113). Three columns control delivery:
  //  - `pushDailySummary`: alert-type opt-in, sits next to pushExpiry /
  //    pushBroadcast on the notifications page. When false, the
  //    scheduled push is suppressed (in-app notification still lands).
  //  - `dailySummaryEnabled`: master on/off for the daily-summary
  //    feature itself (separate from the alert-type switch so users
  //    can disable the digest entirely without touching push prefs).
  //  - `dailySummaryTime`: HH:MM in 24h local-time the digest should
  //    fire at (defaults to 07:00).
  //  - `dailySummaryTimezone`: IANA timezone the time is interpreted in
  //    (defaults to Asia/Jakarta — the project's primary user base).
  //  - `dailySummaryLastSentDate`: YYYY-MM-DD in the user's local
  //    timezone the last digest was sent on. Guards once-per-day
  //    idempotency even if the scheduler ticks multiple times after the
  //    user's scheduled time.
  pushDailySummary: boolean("push_daily_summary").notNull().default(true),
  // Tier 1 push categories (task #140). Same opt-out pattern as the
  // older `pushExpiry` / `pushBroadcast` toggles — when false the
  // OS-level push is suppressed but the in-app notification still
  // surfaces in /notifications. Defaults true so the feature is on for
  // existing accounts without forcing a re-onboarding step.
  pushMarketNews: boolean("push_market_news").notNull().default(true),
  pushCalendarEvents: boolean("push_calendar_events").notNull().default(true),
  // Tier 2 push categories (task #141). Same opt-out pattern as the
  // Tier 1 toggles above — false suppresses OS push only, the in-app
  // notification row still surfaces in /notifications.
  pushPriceAnomaly: boolean("push_price_anomaly").notNull().default(true),
  pushWeeklyRecap: boolean("push_weekly_recap").notNull().default(true),
  pushSignalFlip: boolean("push_signal_flip").notNull().default(true),
  // UI language preference ("en" / "id") — synced from the client
  // i18n provider so background dispatchers (e.g. weekly trader-mirror
  // report, task #162) can render OS push + in-app notification copy
  // in the user's chosen language without depending on per-request
  // headers. Defaults "en" for safety.
  lang: text("lang").notNull().default("en"),
  // Tier 3 push (task #142) — habit & retention nudges. Conservative
  // defaults: dormancy nudge is opt-in (false), onboarding is opt-out
  // (true) and only ever fires once per user.
  //  - `marketOpenSessions`: which FX sessions the user wants a 5-min
  //    pre-open ping for. Empty array = feature off. Stored as jsonb
  //    string array (project convention — see dailyDigests.instruments)
  //    rather than pg text[] so adding session names later is migration-
  //    free.
  //  - `pushDormancyNudge`: opt-in for the "we miss you" weekly nudge.
  //    `dormancyNudgeStreak` is a backoff counter — incremented every
  //    time we send a nudge without the user coming back, reset on any
  //    new analysis. After 3 unanswered nudges the dispatcher auto-
  //    pauses the toggle (set to false) so we stop spamming dead users.
  //    `dormancyLastNudgeAt` is the timestamp of the last nudge — used
  //    to enforce the ≥7d cap.
  //  - `pushOnboarding`: opt-out flag for the 24h-after-signup empty-
  //    watchlist nudge. `onboardingNudgeSentAt` is the one-shot marker
  //    (non-null = already sent, never send again).
  //  - `disengageStreaks` / `disengageNoticeCategory`: shared
  //    auto-disengage engine state. The worker counts consecutive
  //    unread-after-48h notifications per category; after 3 it flips
  //    the matching opt-out boolean to false and stamps the category
  //    name in `disengageNoticeCategory` so the UI can render a
  //    one-time banner explaining what happened.
  marketOpenSessions: jsonb("market_open_sessions").$type<string[]>().notNull().default([]),
  pushDormancyNudge: boolean("push_dormancy_nudge").notNull().default(false),
  pushOnboarding: boolean("push_onboarding").notNull().default(true),
  dormancyNudgeStreak: integer("dormancy_nudge_streak").notNull().default(0),
  dormancyLastNudgeAt: timestamp("dormancy_last_nudge_at"),
  onboardingNudgeSentAt: timestamp("onboarding_nudge_sent_at"),
  disengageStreaks: jsonb("disengage_streaks").$type<Record<string, number>>().notNull().default({}),
  disengageNoticeCategory: text("disengage_notice_category"),
  // Per-category ISO timestamp: when set, the auto-disengage worker
  // ignores notifications older than this for that category. Stamped
  // (a) when the worker hits the pause threshold, and (b) when the
  // user re-opts into a category whose toggle was previously auto-
  // flipped off. Without it, historical unread rows in the 30-day
  // lookback would re-trigger pause/banner on every tick.
  disengageCheckpoints: jsonb("disengage_checkpoints").$type<Record<string, string>>().notNull().default({}),
  // Anti-pattern guardrails (task #163). Soft warnings shown above the
  // analyse button when the user is about to revenge-trade, overtrade,
  // or open a position right before a known high-risk window. Each
  // category has an individual opt-out so a power user can silence the
  // overtrading nag while keeping the imminent-event reminder. Default
  // ON for the three signals (low-noise + protective), OFF for the
  // cooling-off mode (it imposes a 30-min countdown that some users
  // will find too restrictive, so we wait for explicit opt-in).
  guardrailRevenge: boolean("guardrail_revenge").notNull().default(true),
  guardrailOvertrading: boolean("guardrail_overtrading").notNull().default(true),
  guardrailHighRisk: boolean("guardrail_high_risk").notNull().default(true),
  coolingOffEnabled: boolean("cooling_off_enabled").notNull().default(false),
  dailySummaryEnabled: boolean("daily_summary_enabled").notNull().default(false),
  dailySummaryTime: text("daily_summary_time").notNull().default("07:00"),
  dailySummaryTimezone: text("daily_summary_timezone").notNull().default("Asia/Jakarta"),
  dailySummaryLastSentDate: text("daily_summary_last_sent_date"),
  // Persistent brute-force protection for /auth/forgot-password/verify.
  // The IP+email rate limiter is in-memory (resets on restart) and
  // bypassable via IP rotation; these columns layer a per-account
  // counter + temporary lockout that survives restarts and applies no
  // matter where the wrong-answer attempts come from.
  failedResetAttempts: integer("failed_reset_attempts").notNull().default(0),
  resetLockedUntil: timestamp("reset_locked_until"),
  // Per-user analysis-quota override (admin dashboard). Null means "use
  // the global default" (see ANALYSIS_QUOTA_PER_DAY in routes/analyses.ts,
  // itself admin-configurable). A non-null value overrides just this one
  // user, independent of the global setting.
  customQuotaPerDay: integer("custom_quota_per_day"),
  // Legacy columns still exist in development and production. Preserve their
  // data until a separate, explicitly approved removal migration.
  customQuotaPerHour: integer("custom_quota_per_hour"),
  freeTimeframeSwitchesUsed: integer("free_timeframe_switches_used").notNull().default(0),
  // Store-readiness (P2-B4.1): three more push categories, following the
  // exact opt-out pattern as every other `push*` column above — false
  // suppresses OS push only, the in-app notification row still lands.
  pushAnalysisCompleted: boolean("push_analysis_completed").notNull().default(true),
  pushTpSlHit: boolean("push_tp_sl_hit").notNull().default(true),
  // Security-relevant, but still a *preference* for the OS pop-up only —
  // critical security notices (password/email/recovery changes) always
  // create the in-app row regardless of this toggle; see
  // `lib/security-notification.ts`.
  pushLoginAlert: boolean("push_login_alert").notNull().default(true),
  // Per-channel master switches (P2-B3). `nativePushEnabled` gates FCM
  // delivery to `native_push_devices`; `webPushEnabled` gates the existing
  // VAPID Web Push delivery to `push_subscriptions`. Independent of the
  // per-category toggles above — a category must be both "on" and its
  // channel must be "on" for that channel to actually fire.
  nativePushEnabled: boolean("native_push_enabled").notNull().default(true),
  webPushEnabled: boolean("web_push_enabled").notNull().default(true),
  // User-configurable quiet hours (P2-B4.1), read by
  // `lib/notification-guards.ts`'s `withinQuietHours`. Falls back to the
  // function's own defaults (22:00-07:00, Asia/Jakarta) when disabled or
  // when `notificationTimezone` isn't set — see that file for the exact
  // fallback chain (`notificationTimezone` -> legacy `dailySummaryTimezone`
  // -> "Asia/Jakarta").
  quietHoursEnabled: boolean("quiet_hours_enabled").notNull().default(true),
  quietHoursStart: text("quiet_hours_start").notNull().default("22:00"),
  quietHoursEnd: text("quiet_hours_end").notNull().default("07:00"),
  notificationTimezone: text("notification_timezone").notNull().default("Asia/Jakarta"),
  progressionNotificationsEnabled: boolean("progression_notifications_enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// platform distinguishes a cookie-issuing website login from a
// Bearer-token native/mobile-app login (set once at creation in
// lib/session.ts's createSingleSession — never changes for a session's
// lifetime). Needed because the 15-minute idle auto-logout in
// middleware/auth.ts applies to "web" sessions only; native app sessions
// keep relying solely on expiresAt, since a mobile app can legitimately
// sit backgrounded for a long time without that meaning the user left.
export const sessionPlatformEnum = pgEnum("session_platform", ["web", "native"]);

export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  // Updated (throttled, not on every single request) each time a "web"
  // session makes an authenticated request — see requireAuth. Ignored for
  // "native" sessions, which never idle-time-out.
  platform: sessionPlatformEnum("platform").notNull().default("web"),
  lastActivityAt: timestamp("last_activity_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Append-only per-event login/logout log — deliberately NOT inferred from
// `sessions` row creation/deletion, because createSingleSession's
// delete-then-reinsert collapses repeat same-day logins into one row, and
// a session row can also disappear via single-session replacement or
// account deletion, neither of which is a user-initiated logout. This is
// the source for the admin dashboard's "Login Hari Ini"/"Logout Hari Ini"
// counters (counted per event, not per unique user — see routes/admin.ts).
export const authEventTypeEnum = pgEnum("auth_event_type", ["login", "logout"]);

export const authEvents = pgTable("auth_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  eventType: authEventTypeEnum("event_type").notNull(),
  platform: sessionPlatformEnum("platform").notNull(),
  // Only meaningful for "logout": "user_initiated" (POST /auth/logout),
  // "idle_timeout" (15-minute web idle auto-logout), or
  // "account_deleted". Single-session replacement (logging in elsewhere)
  // is deliberately NOT logged as a logout — it isn't user-initiated and
  // would double-count against the same login that caused it.
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userFk: foreignKey({
    name: "auth_events_user_id_fkey",
    columns: [t.userId],
    foreignColumns: [users.id],
  }).onDelete("cascade"),
  createdAtIdx: index("auth_events_created_at_idx").on(t.createdAt),
}));

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Short-lived, single-use re-authentication tokens. Issued after a fresh
// identity proof (e.g. a fresh Google ID token) and consumed by one
// sensitive operation. `tokenHash` is a SHA-256 of the raw token — the raw
// value only ever exists in the issuing response and the consuming
// request. `purpose` binds a token to one operation (e.g. "delete_account").
export const reauthTokens = pgTable("reauth_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  purpose: text("purpose").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Holds a verified TikTok profile between GET /auth/tiktok/callback and
// POST /auth/tiktok/complete-signup for a brand-new TikTok sign-in (no
// existing tiktok_id match). TikTok's Login Kit never returns an email, so
// the user row can't be created yet at callback time — the raw token is
// set in a short-lived httpOnly cookie (never in a URL) and this row is
// the server-side source of truth for the profile it names; a client can't
// forge which tiktok_id gets attached to the account it creates. Same
// shape/rationale as reauthTokens (hashed token, single-use via
// `usedAt`), but for an anonymous pre-account flow instead of an
// already-known user.
export const pendingTiktokSignups = pgTable("pending_tiktok_signups", {
  id: serial("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  tiktokId: text("tiktok_id").notNull(),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  // Set only when this pending signup was reached via the mobile OAuth
  // browser flow (GET /auth/tiktok/mobile/start), not the website. Lets
  // POST /auth/tiktok/complete-signup know to finish the linked
  // mobileOauthTransactions row (issue a one-time exchange code and hand
  // the browser back to the app) instead of creating a normal web
  // session/cookie. Null for an ordinary website signup. FK defined below
  // with an explicit short name — Drizzle's auto-generated name for this
  // pair (`pending_tiktok_signups_mobile_transaction_id_mobile_oauth_transactions_id_fk`)
  // exceeds Postgres's 63-byte identifier limit, gets silently truncated
  // on creation, and then never matches what `drizzle-kit push` expects on
  // the next run — every push after the first would re-"fix" it forever.
  mobileTransactionId: integer("mobile_transaction_id"),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  mobileTransactionFk: foreignKey({
    name: "pending_tiktok_signups_mobile_tx_fk",
    columns: [t.mobileTransactionId],
    foreignColumns: [mobileOauthTransactions.id],
  }).onDelete("set null"),
}));

// Persistent (never in-memory — the API can run as multiple instances)
// state for the mobile OAuth browser flow: Flutter opens a system browser
// at GET /auth/{facebook,tiktok}/mobile/start, which redirects to the
// provider with a `state` that maps to one row here instead of a cookie
// (a native system-browser tab can't rely on the app's own cookie jar the
// way a same-origin web redirect can). The existing web
// GET /auth/{facebook,tiktok}/callback routes tell mobile and web apart by
// checking whether the incoming `state` matches a row here BEFORE falling
// back to their existing cookie-based check — the web flow's behavior is
// completely unchanged when it doesn't.
//
// Two phases, tracked by which columns are set:
//   1. "pending"  — issued by /mobile/start; provider hasn't verified yet.
//   2. "issued"   — the provider callback verified the user and stashed
//      `userId` + `exchangeCodeHash` + `codeExpiresAt`; POST
//      /auth/mobile/exchange is the only consumer, and it's a short
//      (60-120s) window by design — this is a handoff, not a session.
// `consumedAt` makes the exchange one-time-use; enforced atomically via a
// conditional UPDATE ... WHERE consumed_at IS NULL (see lib/mobile-oauth.ts),
// the same pattern topups.ts and reauth.ts already use for single-use rows.
export const mobileOauthTransactions = pgTable("mobile_oauth_transactions", {
  id: serial("id").primaryKey(),
  // SHA-256 of the `state` value round-tripped through the provider —
  // this IS the CSRF/session-binding check (equivalent to the web flow's
  // cookie-equals-query-param comparison), so the raw value is never
  // stored.
  stateHash: text("state_hash").notNull().unique("mobile_oauth_transactions_state_hash_key"),
  provider: text("provider").notNull(), // "facebook" | "tiktok"
  // Validated once at /mobile/start against MOBILE_OAUTH_REDIRECT_URIS
  // (exact-match allowlist, never re-validated from client input again) —
  // reused verbatim for every subsequent redirect this transaction makes.
  redirectUri: text("redirect_uri").notNull(),
  mobileCodeChallenge: text("mobile_code_challenge").notNull(),
  mobileCodeChallengeMethod: text("mobile_code_challenge_method").notNull().default("S256"),
  // TikTok's OWN PKCE verifier for its provider-side code exchange
  // (equivalent to the tt_oauth_verifier cookie the web flow uses) — a
  // system browser tab started fresh by the app can't carry that cookie
  // back to a different backend instance, so it lives here instead.
  // Unused for Facebook (no provider-side PKCE in this app's flow).
  providerCodeVerifier: text("provider_code_verifier"),
  userId: integer("user_id"),
  isNewUser: boolean("is_new_user").notNull().default(false),
  exchangeCodeHash: text("exchange_code_hash").unique("mobile_oauth_transactions_exchange_code_hash_key"),
  codeExpiresAt: timestamp("code_expires_at"),
  consumedAt: timestamp("consumed_at"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userFk: foreignKey({
    name: "mobile_oauth_transactions_user_id_fkey",
    columns: [t.userId],
    foreignColumns: [users.id],
  }).onDelete("cascade"),
}));

// Short-lived, single-use handoff from a logged-in mobile app session to
// a browser tab, so tapping "Kredit Analisis" in Profil doesn't force a
// second login. POST /auth/web-handoff (Bearer-authenticated) mints a row
// here and hands the raw code back in a URL; GET /auth/web-handoff/consume
// (no auth — opened in the system browser) looks it up by hash, atomically
// claims it via `UPDATE ... WHERE used_at IS NULL AND expires_at > now()`
// (same one-time-use idiom as mobileOauthTransactions/topups/reauth — see
// lib/web-handoff.ts), and mints a *web* session for userId before
// redirecting to `next`. 60s TTL — this is a same-moment handoff, not a
// session of its own. Deliberately its own table rather than reusing
// mobileOauthTransactions: that table's columns (provider, redirectUri,
// PKCE challenge) are OAuth-specific and don't apply here.
export const webHandoffCodes = pgTable("web_handoff_codes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  codeHash: text("code_hash").notNull().unique("web_handoff_codes_code_hash_key"),
  // Relative path only, checked against an allowlist at issue time
  // (see isAllowedNextPath in lib/web-handoff.ts) and never re-read from
  // client input at consume time — the browser GET only ever reads this
  // column, never a query parameter, so there is no open-redirect surface.
  next: text("next").notNull(),
  usedAt: timestamp("used_at"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userFk: foreignKey({
    name: "web_handoff_codes_user_id_fkey",
    columns: [t.userId],
    foreignColumns: [users.id],
  }).onDelete("cascade"),
}));

export const analyses = pgTable("analyses", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  instrument: text("instrument").notNull(),
  timeframe: text("timeframe").notNull(),
  mode: modeEnum("mode").notNull(),
  userInputContext: text("user_input_context"),
  rawAiOutput: text("raw_ai_output"),
  validUntil: timestamp("valid_until").notNull(),
  marketCondition: marketConditionEnum("market_condition").notNull(),
  riskLevel: riskLevelEnum("risk_level").notNull(),
  confidenceMin: integer("confidence_min").notNull(),
  confidenceMax: integer("confidence_max").notNull(),
  mainScenario: text("main_scenario"),
  alternativeScenario: text("alternative_scenario"),
  whyReason: text("why_reason"),
  failureConditions: text("failure_conditions"),
  baseCase: text("base_case"),
  bullishScenario: text("bullish_scenario"),
  bearishScenario: text("bearish_scenario"),
  keyDriversTechnical: text("key_drivers_technical"),
  keyDriversFundamental: text("key_drivers_fundamental"),
  marketContext: text("market_context"),
  invalidationConditions: text("invalidation_conditions"),
  uncertaintyNotes: text("uncertainty_notes"),
  tradingBias: text("trading_bias"),
  opportunity: text("opportunity"),
  risk: text("risk"),
  // Snapshot of the technical-indicator tally at analysis time so the saved
  // analysis page can render the same Market Context Summary card the user
  // saw on the Analyze tab. Nullable: legacy rows + intraday timeframes
  // without indicator support won't have these.
  techBuyCount: integer("tech_buy_count"),
  techSellCount: integer("tech_sell_count"),
  techNeutralCount: integer("tech_neutral_count"),
  // Structured trade plan (entry/SL/TP for both buy and sell scenarios)
  // generated by the AI and anchored to the latest closing price. Stored as
  // JSONB so the saved analysis page can render concrete suggested levels
  // without re-prompting the model. Nullable for legacy rows + cases where
  // no anchor price was available at analysis time.
  tradePlan: jsonb("trade_plan").$type<TradePlanShape>(),
  // Selected-timeframe candle data and its source freshness at creation time.
  // Nullable for legacy rows and timeframes with no candle feed.
  marketSnapshot: jsonb("market_snapshot").$type<MarketSnapshotShape>(),
  // Snapshot of the news headlines + economic-calendar events the AI
  // saw when generating this analysis (task #88). Lets the saved
  // analysis page render the *same* fundamental context the model used,
  // and gives us provenance to verify that fundamental commentary is
  // grounded in real, citable sources rather than fabricated. Nullable
  // for legacy rows + cases where both upstream feeds were down.
  fundamentalContext: jsonb("fundamental_context").$type<FundamentalContextShape>(),
  // Which subset of `fundamentalContext` the AI actually cited in the
  // narrative blocks (task #89). Stored as JSONB so the saved-analysis
  // page can render inline source chips next to the AI's reasoning.
  // Nullable for legacy rows + analyses where the AI didn't lean on
  // any fundamental input.
  fundamentalCitations: jsonb("fundamental_citations").$type<FundamentalCitationsShape>(),
  // After-the-fact resolution of the AI's trade plan: did price actually
  // touch TP1 / TP2 / SL inside the validity window, or did the window
  // expire first? Populated by the background resolver in `lib/outcomes.ts`.
  // `outcomeStatus` defaults to 'pending' for new rows; `outcomeResolvedAt`
  // is the bar timestamp the trigger was hit on (or validUntil for
  // 'expired'); `outcomeCheckedAt` records when the resolver last looked.
  outcomeStatus: analysisOutcomeEnum("outcome_status").notNull().default("pending"),
  outcomeResolvedAt: timestamp("outcome_resolved_at"),
  outcomeCheckedAt: timestamp("outcome_checked_at"),
  // Private per-analysis trading journal note written by the owning user
  // (task #111). Plain text only — never fed into the AI prompt and never
  // exposed across users (ownership is already enforced by analyses.userId).
  // `userNoteUpdatedAt` is stamped server-side on every PUT so the
  // detail-page "Saved · {time}" indicator reflects the actual persisted
  // write, not the client clock.
  userNote: text("user_note"),
  userNoteUpdatedAt: timestamp("user_note_updated_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const instrumentRequests = pgTable("instrument_requests", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  code: text("code").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastRequestedAt: timestamp("last_requested_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userFk: foreignKey({
    name: "instrument_requests_user_id_fkey",
    columns: [t.userId],
    foreignColumns: [users.id],
  }).onDelete("cascade"),
  userCode: uniqueIndex("instrument_requests_user_code_unique").on(t.userId, t.code),
  codeIndex: index("instrument_requests_code_idx").on(t.code),
}));

export const feedback = pgTable("feedback", {
  id: serial("id").primaryKey(),
  analysisId: integer("analysis_id")
    .notNull()
    .references(() => analyses.id, { onDelete: "cascade" }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  feedbackType: feedbackTypeEnum("feedback_type").notNull(),
  outcome: outcomeEnum("outcome"),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
    targetRole: roleEnum("target_role"),
    title: text("title").notNull(),
    message: text("message").notNull(),
    type: notificationTypeEnum("type").notNull().default("info"),
    readAt: timestamp("read_at"),
    // Category tag used by the anti-annoyance engine in
    // `lib/notification-guards.ts` (task #140) to count per-category
    // sends inside a rolling window without depending on title/message
    // string-matching. Existing jobs can leave it null — the guards
    // only care about rows that opt into a category.
    category: text("category"),
    // Cross-run dedupe key (task #140). When set, the dispatcher
    // checks for an existing row with the same key before inserting,
    // so a 5-minute job tick can never deliver the same news/calendar
    // event twice to the same user. Postgres unique constraints allow
    // multiple NULLs, so legacy rows without a key coexist fine.
    dedupeKey: text("dedupe_key"),
    // Store-readiness (P2-B2): allowlisted tap-target for actionable
    // notifications. `actionId` is the id of the entity `actionType`
    // refers to (e.g. an analysis id when actionType="open_analysis").
    // Both nullable — a plain informational notification has neither, and
    // the client falls back to "just mark it read" for any
    // actionType/actionId combination it doesn't recognise, so older
    // clients stay forward-compatible with new action types added later.
    actionType: notificationActionTypeEnum("action_type"),
    actionId: text("action_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    dedupeKeyUnique: uniqueIndex("notifications_dedupe_key_unique").on(t.dedupeKey),
  }),
);

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Store-readiness (P2-B3): native push (FCM) device registrations, kept as
// a table separate from `push_subscriptions` (Web Push/VAPID) because the
// shapes don't overlap at all — a device token has no p256dh/auth keys,
// and a Web Push endpoint has no platform. `token` is globally unique
// (not per-user) because the same physical device token can only ever
// belong to one account at a time; registering it again from a different
// account transfers ownership via upsert (see routes/native-push.ts) —
// this is the correct behavior for a shared/re-logged-in device.
export const nativePushDevices = pgTable("native_push_devices", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull(),
  platform: nativePushPlatformEnum("platform").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  lastSeenAt: timestamp("last_seen_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  tokenUnique: uniqueIndex("native_push_devices_token_unique").on(t.token),
}));

export const userTags = pgTable(
  "user_tags",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    userTagUnique: uniqueIndex("user_tags_user_tag_unique").on(t.userId, t.tag),
  }),
);

// Outbound click telemetry for sponsor / partner links (SOLID PRIME demo
// account CTA, TikTok @solid.prime live-analysis link, etc). userId is
// nullable because most surfaces — splash, landing header/footer/CTA — are
// reachable while signed out. `placement` is a stable slug (e.g.
// `landing-cta`) so the admin breakdown stays meaningful even after copy
// changes; `target` is the partner key (`sg-berjangka` or `tiktok`).
export const outboundClicks = pgTable("outbound_clicks", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  placement: text("placement").notNull(),
  target: text("target").notNull(),
  lang: text("lang"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// One row per AI-generated level (entry / SL / TP1 / TP2) the user has
// opted in to be pinged about. The background watcher in `price-alerts.ts`
// polls live prices, fires a Web Push the first time `levelPrice` is
// crossed in `triggerDirection`, and stamps `triggeredAt`. Once a row's
// `validUntil` passes or any SL/TP on the same analysis fires, the
// remaining rows for that analysis are `cancelledAt`'d so the user
// doesn't keep getting alerts on a trade that already resolved.
export const priceAlerts = pgTable(
  "price_alerts",
  {
    id: serial("id").primaryKey(),
    analysisId: integer("analysis_id")
      .notNull()
      .references(() => analyses.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    instrument: text("instrument").notNull(),
    // Trade side this level belongs to ("buy" or "sell"). Stored as text
    // rather than a new enum because the existing TradePlanShape side
    // values are already a free-form union — keeping them aligned.
    side: text("side").notNull(),
    level: alertLevelEnum("level").notNull(),
    // The actual price the watcher compares against. Stored as text to
    // preserve the AI's exact precision (e.g. "1.08573") without falling
    // into numeric/float rounding — parsed back to a Number in the
    // watcher.
    levelPrice: text("level_price").notNull(),
    triggerDirection: alertDirectionEnum("trigger_direction").notNull(),
    validUntil: timestamp("valid_until").notNull(),
    triggeredAt: timestamp("triggered_at"),
    // Price the watcher saw when it decided the level had been crossed.
    // Logged for debugging "why did this fire?" support questions.
    triggeredPrice: text("triggered_price"),
    cancelledAt: timestamp("cancelled_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    // The watcher tick scans by `(triggeredAt IS NULL, cancelledAt IS NULL,
    // validUntil > now)` grouped by instrument — this composite index keeps
    // that scan cheap as the table grows.
    activeByInstrument: uniqueIndex("price_alerts_unique_per_analysis_level").on(
      t.analysisId,
      t.level,
      t.side,
    ),
  }),
);

// One row per (user, calendar-day-in-user-TZ) once the morning digest
// has been generated and pushed (task #113). Persisted so:
//  1. The scheduler can idempotently skip users whose digest already
//     ran today even if the worker restarts mid-day.
//  2. The `/daily-summary` landing page can render the exact set of
//     analyses the push referenced (looked up by `analysisIds`) instead
//     of re-querying "latest" which would drift if newer analyses landed
//     after the digest fired.
// `kind` distinguishes a `full` digest (newly-generated or recently-
// reused analyses) from a `quota_only` digest sent when the user's
// hourly/daily AI quota was already exhausted (we still send something
// useful — the user's most recent existing analyses for the picked
// instruments).
export const dailyDigests = pgTable(
  "daily_digests",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // YYYY-MM-DD in the user's chosen IANA timezone — NOT a UTC date.
    // Stored as text so timezone arithmetic stays in JS and we don't
    // need to coerce a `date` column through pg's session timezone.
    digestDate: text("digest_date").notNull(),
    kind: text("kind").notNull(), // 'full' | 'quota_only'
    // The 3 instruments the digest covered, in display order.
    instruments: jsonb("instruments").notNull().$type<string[]>(),
    // FK-less list of analyses.id rows surfaced by this digest. We don't
    // model a separate join table because the order matters (it's the
    // same order as `instruments`) and the count is bounded at 3.
    analysisIds: jsonb("analysis_ids").notNull().$type<number[]>(),
    // Plain-text body sent in the push notification, persisted so the
    // landing page can echo it back ("you were told: X") for context.
    summary: text("summary").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    // One digest per user per local day — the scheduler relies on this
    // unique constraint as a hard backstop against duplicate pushes.
    perUserPerDay: uniqueIndex("daily_digests_user_day_unique").on(t.userId, t.digestDate),
  }),
);

// Saved history-page filter combinations a user can recall with one tap
// (task #129). `filters` mirrors the URL-derived FilterState the history
// page already uses (mode + instruments[] + timeframes[] + from/to + q),
// stored as JSONB so adding a new filter key later doesn't need a
// migration. The (userId, name) unique constraint enforces "no two
// presets with the same name for one user" at the DB level, so a
// concurrent double-create can't slip through the validate-then-insert
// race in the route handler.
export const filterPresets = pgTable(
  "filter_presets",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    filters: jsonb("filters").notNull().$type<FilterPresetShape>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    perUserNameUnique: uniqueIndex("filter_presets_user_name_unique").on(
      t.userId,
      t.name,
    ),
  }),
);

export type FilterPresetShape = {
  mode: "beginner" | "pro" | "";
  instruments: string[];
  timeframes: string[];
  from: string;
  to: string;
  q: string;
};

// Per-user instrument watchlist (task #109). One row per starred
// instrument; uniqueness is enforced at the DB level so a double-tap
// on the star button can't create duplicates. Read by the "My
// Watchlist" dashboard section, which joins each row to live quotes
// + the user's most recent analysis for that instrument.
export const watchlistItems = pgTable(
  "watchlist_items",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    instrument: text("instrument").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    userInstrumentUnique: uniqueIndex("watchlist_items_user_instrument_unique").on(
      t.userId,
      t.instrument,
    ),
  }),
);

// User-defined standalone price alerts (task #148). Unlike `priceAlerts`
// above (which is tied to AI-generated entry/SL/TP levels on a specific
// analysis), each row here represents a manual "ping me when EUR/USD
// crosses 1.0900 from below" request the user typed in themselves. The
// background checker in `user-price-alerts.ts` compares the live tick
// against `targetPrice` and `lastSeenPrice` — only fires on an actual
// *crossing* between the two ticks, so an alert created with the price
// already above its `above`-target does NOT fire on the very next poll.
// One-shot: once fired (or deleted) the row's `status` flips and it is
// excluded from the watcher loop forever.
export const userAlertStatusEnum = pgEnum("user_alert_status", [
  "active",
  "triggered",
  "cancelled",
]);

export const userPriceAlerts = pgTable("user_price_alerts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  instrument: text("instrument").notNull(),
  // Stored as text to preserve the exact precision the user typed (e.g.
  // "1.08573") without falling into numeric/float rounding — parsed back
  // to a Number in the watcher.
  targetPrice: text("target_price").notNull(),
  triggerDirection: alertDirectionEnum("trigger_direction").notNull(),
  // Optional one-line user note ("EUR/USD breakout above 1.09").
  note: text("note"),
  // UI language at create time ("en" / "id") — used by the push
  // dispatcher so the OS notification is rendered in the language the
  // user was using when they set the alert. Defaults "en" for safety.
  lang: text("lang").notNull().default("en"),
  status: userAlertStatusEnum("status").notNull().default("active"),
  // Spot price last seen by the checker (or at create time). The
  // watcher only fires when the previous tick was on the *wrong* side
  // of the target and the current tick is on the right side — this is
  // the anti-false-fire guard that keeps "above 1.09" from triggering
  // immediately for a user who set it while EUR/USD was already at 1.10.
  lastSeenPrice: text("last_seen_price"),
  triggeredAt: timestamp("triggered_at"),
  triggeredPrice: text("triggered_price"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Manual post-trade journal entries (task #161). Each row is a user-
// reported log of an actual trade they took (or chose to pass on),
// optionally linked back to the AI analysis that informed it. Keys on
// `userId` + nullable `analysisId` (one analysis can spawn multiple
// journal entries, e.g. a partial scale-out). Prices/PnL are stored as
// text to preserve the exact precision the user typed (mirrors the
// `user_price_alerts.target_price` convention). The note body is
// private and never fed into any AI prompt.
export const tradeSideEnum = pgEnum("trade_side", ["buy", "sell"]);
export const tradeOutcomeEnum = pgEnum("trade_outcome", [
  "win",
  "loss",
  "breakeven",
  "open",
  "skipped",
]);

export const tradeJournal = pgTable("trade_journal", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Nullable: users can journal a trade with no AI analysis behind it
  // ("walked into something on the chart"). When the source analysis
  // is later deleted we keep the row but null the FK — the trade still
  // happened.
  analysisId: integer("analysis_id").references(() => analyses.id, {
    onDelete: "set null",
  }),
  instrument: text("instrument").notNull(),
  side: tradeSideEnum("side").notNull(),
  // Numeric strings — kept verbatim (no float rounding). Entry is
  // required when `tookTrade` is true; exit/pnl are populated once the
  // trade is closed. For `tookTrade=false` (skipped) the user logs only
  // an outcome of "skipped" + reason in the note.
  entryPrice: text("entry_price"),
  exitPrice: text("exit_price"),
  quantity: text("quantity"),
  pnlAmount: text("pnl_amount"),
  pnlPercent: text("pnl_percent"),
  outcome: tradeOutcomeEnum("outcome").notNull().default("open"),
  // Free-form mood tag (e.g. "confident", "fomo", "revenge"). Loose
  // string so the UI can present a recommended chip set without locking
  // the schema. Capped server-side.
  mood: text("mood"),
  note: text("note"),
  // When the trade was opened (user-provided; defaults to createdAt on
  // insert). Used by the session-tag derivation in the stats endpoint
  // so "best session" reflects when the user *traded*, not when they
  // happened to log it later in the evening.
  tradedAt: timestamp("traded_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const broadcasts = pgTable("broadcasts", {
  id: serial("id").primaryKey(),
  senderId: integer("sender_id").references(() => users.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull(),
  message: text("message").notNull(),
  audienceType: audienceTypeEnum("audience_type").notNull(),
  audienceValue: text("audience_value"),
  recipientCount: integer("recipient_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type Analysis = typeof analyses.$inferSelect;
export type NewAnalysis = typeof analyses.$inferInsert;
export type Feedback = typeof feedback.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type UserTag = typeof userTags.$inferSelect;
export type Broadcast = typeof broadcasts.$inferSelect;
export type NewBroadcast = typeof broadcasts.$inferInsert;
export type OutboundClick = typeof outboundClicks.$inferSelect;
export type NewOutboundClick = typeof outboundClicks.$inferInsert;
export type PriceAlert = typeof priceAlerts.$inferSelect;
export type NewPriceAlert = typeof priceAlerts.$inferInsert;
export type DailyDigest = typeof dailyDigests.$inferSelect;
export type NewDailyDigest = typeof dailyDigests.$inferInsert;
export type FilterPreset = typeof filterPresets.$inferSelect;
export type NewFilterPreset = typeof filterPresets.$inferInsert;
export type UserPriceAlert = typeof userPriceAlerts.$inferSelect;
export type NewUserPriceAlert = typeof userPriceAlerts.$inferInsert;
export type TradeJournalEntry = typeof tradeJournal.$inferSelect;
export type NewTradeJournalEntry = typeof tradeJournal.$inferInsert;

// Anti-pattern guardrail telemetry (task #163). One row each time a
// soft warning is shown to the user. `proceeded` flips to true if the
// user pressed "Analyse anyway" after seeing the warning; null/false
// means the warning was shown and either dismissed or the page
// unmounted before they clicked through. Feeds the Mirror digest
// (task #162) and the personal-analytics page.
export const guardrailKindEnum = pgEnum("guardrail_kind", [
  "revenge",
  "overtrading",
  "high_risk_window",
  "unusual_hour",
  "cooling_off",
]);

export const guardrailEvents = pgTable("guardrail_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: guardrailKindEnum("kind").notNull(),
  instrument: text("instrument"),
  firedAt: timestamp("fired_at").notNull().defaultNow(),
  proceeded: boolean("proceeded").notNull().default(false),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
});

export type GuardrailEvent = typeof guardrailEvents.$inferSelect;
export type NewGuardrailEvent = typeof guardrailEvents.$inferInsert;

// Personal progression (task #104). These records intentionally contain no
// P/L, trade count, outcome, or market-performance fields. The ledger is
// append-only: corrections are separate negative/positive rows linked through
// metadata, never an update or delete of a prior award.
export const progressionProfiles = pgTable("progression_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  totalXp: integer("total_xp").notNull().default(0),
  level: integer("level").notNull().default(1),
  masteryLevel: integer("mastery_level").notNull().default(0),
  rankKey: text("rank_key").notNull().default("seedling"),
  currentStreak: integer("current_streak").notNull().default(0),
  longestStreak: integer("longest_streak").notNull().default(0),
  lastDisciplineDay: text("last_discipline_day"),
  // Frozen on first progression activity so preference changes cannot rewrite
  // historical cap/streak/checklist calendar boundaries.
  progressionTimezone: text("progression_timezone").notNull().default("UTC"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({ perUser: uniqueIndex("progression_profiles_user_unique").on(t.userId) }));

// Atomic anti-noise gate for progression notifications. It is deliberately
// separate from the ledger: suppressing a notice never suppresses an award.
export const progressionNotificationCooldowns = pgTable("progression_notification_cooldowns", {
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  category: text("category").notNull(),
  lastSentAt: timestamp("last_sent_at").notNull().defaultNow(),
}, (t) => ({ perUserCategory: uniqueIndex("progression_notification_cooldowns_unique").on(t.userId, t.category) }));

export const progressionProofs = pgTable("progression_proofs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  source: text("source").notNull(),
  sourceEventId: text("source_event_id").notNull(),
  qualityScore: integer("quality_score").notNull().default(0),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  decision: text("decision").notNull().default("accepted"),
  rejectionReason: text("rejection_reason"),
  occurredAt: timestamp("occurred_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({ perUserSource: uniqueIndex("progression_proofs_user_source_unique").on(t.userId, t.source, t.sourceEventId) }));

export const xpLedger = pgTable("xp_ledger", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  source: text("source").notNull(),
  sourceEventId: text("source_event_id").notNull(),
  proofId: integer("proof_id").references(() => progressionProofs.id, { onDelete: "restrict" }),
  xp: integer("xp").notNull(),
  dayBucket: text("day_bucket").notNull(),
  ruleVersion: text("rule_version").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  // Kept as an immutable ledger id rather than a self FK so schema
  // initialization remains acyclic; correction service verifies it.
  correctionOfLedgerId: integer("correction_of_ledger_id"),
  correctionReason: text("correction_reason"),
  signature: text("signature"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({ perUserSource: uniqueIndex("xp_ledger_user_source_event_unique").on(t.userId, t.source, t.sourceEventId) }));

export const progressionAchievements = pgTable("progression_achievements", {
  id: serial("id").primaryKey(),
  key: text("key").notNull(),
  unlockedAt: timestamp("unlocked_at").notNull().defaultNow(),
  sourceLedgerId: integer("source_ledger_id").references(() => xpLedger.id, { onDelete: "restrict" }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
}, (t) => ({ perUserAchievement: uniqueIndex("progression_achievements_user_key_unique").on(t.userId, t.key) }));

// Server-issued, one-time completion challenge. The plaintext token is only
// returned at issue time; completing an activity consumes this row atomically.
export const progressionEvidenceSessions = pgTable("progression_evidence_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  subject: text("subject").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  issuedAt: timestamp("issued_at").notNull().defaultNow(),
  minimumCompleteAt: timestamp("minimum_complete_at").notNull(),
  consumedAt: timestamp("consumed_at"),
  decision: text("decision").notNull().default("issued"),
});

export const creditTopupStatusEnum = pgEnum("credit_topup_status", ["pending", "approved", "rejected"]);
export const creditTopupProviderEnum = pgEnum("credit_topup_provider", ["manual", "doku"]);

// One row per top-up attempt. Two payment paths now share this table:
// "manual" (submit proof of a QRIS/bank transfer, currently auto-approved —
// see routes/topups.ts) and "doku" (DOKU Checkout hosted payment page,
// approved by an incoming webhook once DOKU confirms payment). Money is
// stored as a whole-Rupiah integer (no subunit in practice), not a float.
// creditsRequested/conversionRateSnapshot are frozen at submission time so
// a later rate change can't retroactively alter what an already-submitted
// request is worth.
export const creditTopupRequests = pgTable("credit_topup_requests", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  amountRupiah: integer("amount_rupiah").notNull(),
  creditsRequested: integer("credits_requested").notNull(),
  conversionRateSnapshot: integer("conversion_rate_snapshot").notNull(),
  paymentReferenceNote: text("payment_reference_note"),
  proofObjectPath: text("proof_object_path"),
  status: creditTopupStatusEnum("status").notNull().default("pending"),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at"),
  reviewNote: text("review_note"),
  creditsGranted: integer("credits_granted"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  paymentProvider: creditTopupProviderEnum("payment_provider").notNull().default("manual"),
  // DOKU-only fields below — null for "manual" rows. dokuInvoiceNumber is
  // the order.invoice_number sent to DOKU Checkout and echoed back in the
  // payment notification; it's how the webhook finds this row (never the
  // DOKU-side session_id/token_id, which we also keep only for support
  // lookups). Unique so DOKU can never accidentally be given a duplicate.
  dokuInvoiceNumber: text("doku_invoice_number").unique(),
  dokuSessionId: text("doku_session_id"),
  dokuPaymentUrl: text("doku_payment_url"),
  dokuExpiresAt: timestamp("doku_expires_at"),
  // Soft delete only (DELETE /admin/topups/:id) — the row is never
  // physically removed because credit_ledger.topupRequestId references it
  // with onDelete "restrict" once approved, and even for a never-approved
  // request a hard delete would erase the record permanently. When an
  // approved request is "deleted", the admin route also appends a negative
  // credit_ledger entry (source "topup_reversal") clawing back the granted
  // credits before setting this — see routes/topups.ts.
  deletedAt: timestamp("deleted_at"),
  deletedByUserId: integer("deleted_by_user_id"),
}, (t) => ({
  statusIdx: index("credit_topup_requests_status_idx").on(t.status),
  userIdx: index("credit_topup_requests_user_idx").on(t.userId),
  deletedByUserFk: foreignKey({
    name: "credit_topup_requests_deleted_by_user_id_fkey",
    columns: [t.deletedByUserId],
    foreignColumns: [users.id],
  }).onDelete("set null"),
}));

// Append-only ledger of every credit movement (top-up approvals, analysis
// consumption, admin corrections) — mirrors xp_ledger exactly: never
// UPDATE/DELETE a row, idempotency via the unique (userId, source,
// sourceEventId) index, corrections are new rows referencing the original.
export const creditLedger = pgTable("credit_ledger", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  source: text("source").notNull(),
  sourceEventId: text("source_event_id").notNull(),
  amount: integer("amount").notNull(),
  topupRequestId: integer("topup_request_id").references(() => creditTopupRequests.id, { onDelete: "restrict" }),
  analysisId: integer("analysis_id").references(() => analyses.id, { onDelete: "restrict" }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  correctionOfLedgerId: integer("correction_of_ledger_id"),
  correctionReason: text("correction_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  perUserSource: uniqueIndex("credit_ledger_user_source_event_unique").on(t.userId, t.source, t.sourceEventId),
}));

// Denormalized running total, recomputed via sum(creditLedger.amount) inside
// the same transaction as every ledger insert — the same role
// progressionProfiles plays for xpLedger. Kept in its own table rather than
// a column on `users` to keep money state physically separate from the
// large identity/preferences user row.
export const creditBalances = pgTable("credit_balances", {
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  balance: integer("balance").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({ perUser: uniqueIndex("credit_balances_user_unique").on(t.userId) }));

// Generic app-usage telemetry: one row per page view or key action
// (see the server-side eventType allowlist in routes/events.ts).
// userId is nullable — most page views happen pre-login (landing,
// login). Device/browser/os are parsed server-side from the request's
// User-Agent; country is resolved server-side from the request IP.
// The raw IP is deliberately NOT persisted here — only the derived
// country — to keep stored personal data to a minimum.
export const analyticsEvents = pgTable("analytics_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  eventType: text("event_type").notNull(),
  path: text("path"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  userAgent: text("user_agent"),
  deviceType: text("device_type"),
  browser: text("browser"),
  os: text("os"),
  country: text("country"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AnalyticsEvent = typeof analyticsEvents.$inferSelect;
export type NewAnalyticsEvent = typeof analyticsEvents.$inferInsert;

// One row per AI analysis generation (main model call + any schema/
// citation-correction retries), capturing OpenAI token usage and an
// estimated USD cost so admin can track AI spend over time. analysisId
// is nullable because usage is recorded even when the final output is
// the synthetic fast-intraday fallback (no `analyses` row exists yet
// for that path in some cases) or when the digest batch job runs it
// without persisting a user-facing analysis row.
export const aiTokenUsage = pgTable("ai_token_usage", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  analysisId: integer("analysis_id").references(() => analyses.id, {
    onDelete: "set null",
  }),
  model: text("model").notNull(),
  promptTokens: integer("prompt_tokens").notNull(),
  completionTokens: integer("completion_tokens").notNull(),
  totalTokens: integer("total_tokens").notNull(),
  callCount: integer("call_count").notNull(),
  estimatedCostUsd: numeric("estimated_cost_usd", { precision: 10, scale: 6 }).notNull(),
  instrument: text("instrument"),
  timeframe: text("timeframe"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AiTokenUsage = typeof aiTokenUsage.$inferSelect;
export type NewAiTokenUsage = typeof aiTokenUsage.$inferInsert;

// Trade Pilot BFF contract. These tables intentionally use the opaque HMAC
// user id supplied by get-sgb and never reference the consumer application's
// users table, so this service does not need to persist customer PII.
// One row per opaque get-sgb user. Holds no PII: only the HMAC user id, the
// first mode seen, and when the first /bootstrap was served (drives isNewUser).
export const tradePilotUsers = pgTable("tp_user", {
  userId: text("user_id").primaryKey(),
  firstSeenMode: text("first_seen_mode").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  bootstrappedAt: timestamp("bootstrapped_at", { withTimezone: true }),
});

export const tradePilotCreditBalances = pgTable("tp_credit_balance", {
  userId: text("user_id").notNull(),
  mode: text("mode").notNull(),
  allowance: integer("allowance").notNull(),
  consumed: integer("consumed").notNull().default(0),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  resetsAt: timestamp("resets_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.mode] }),
  resetIdx: index("tp_credit_balance_resets_at_idx").on(t.resetsAt),
}));

export const tradePilotAnalyses = pgTable("tp_analysis", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  mode: text("mode").notNull(),
  instrumentId: text("instrument_id").notNull(),
  instrumentLabel: text("instrument_label").notNull(),
  timeframe: text("timeframe").notNull(),
  timeframeLabel: text("timeframe_label").notNull(),
  direction: text("direction").notNull(),
  marketSentiment: text("market_sentiment").notNull(),
  priceAtAnalysis: numeric("price_at_analysis", { precision: 24, scale: 8 }).notNull(),
  buyLevels: jsonb("buy_levels").$type<{
    entry: string; stopLoss: string; takeProfitOne: string; takeProfitTwo: string;
  }>().notNull(),
  sellLevels: jsonb("sell_levels").$type<{
    entry: string; stopLoss: string; takeProfitOne: string; takeProfitTwo: string;
  }>().notNull(),
  indicators: jsonb("indicators").$type<Array<{
    key: string; label: string; group: string; value: string; status: string; marker: number;
  }>>().notNull().default([]),
  status: text("status").notNull().default("still_valid"),
  activeSide: text("active_side"),
  takeProfitOneHitAt: timestamp("take_profit_one_hit_at", { withTimezone: true }),
  lastEvaluatedPrice: numeric("last_evaluated_price", { precision: 24, scale: 8 }),
  analyzedAt: timestamp("analyzed_at", { withTimezone: true }).notNull().defaultNow(),
  validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  // Data snapshot the analysis was computed from (requirement: dataSnapshot).
  candleCount: integer("candle_count"),
  candleAsOf: timestamp("candle_as_of", { withTimezone: true }),
  // Localized market context ({ id: {title, description, note}, en: {...} }).
  marketContext: jsonb("market_context").$type<Record<string, { title: string; description: string; note: string }>>(),
  // Audit trail (retain >= 5 years): model, prompt fingerprint, exact AI
  // input context and raw AI output, plus token cost for observability.
  model: text("model"),
  promptVersion: text("prompt_version"),
  aiInput: jsonb("ai_input").$type<Record<string, unknown>>(),
  aiOutput: jsonb("ai_output").$type<Record<string, unknown>>(),
  aiCacheHit: boolean("ai_cache_hit").notNull().default(false),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  estimatedCostUsd: numeric("estimated_cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
  requestId: text("request_id"),
}, (t) => ({
  historyIdx: index("tp_analysis_user_mode_analyzed_idx").on(t.userId, t.mode, t.analyzedAt),
  statusIdx: index("tp_analysis_status_idx").on(t.status),
}));

export const tradePilotIdempotency = pgTable("tp_idempotency", {
  userId: text("user_id").notNull(),
  key: text("key").notNull(),
  requestHash: text("request_hash").notNull(),
  analysisId: text("analysis_id").notNull().references(() => tradePilotAnalyses.id, { onDelete: "cascade" }),
  response: jsonb("response").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.key] }),
  expiryIdx: index("tp_idempotency_created_at_idx").on(t.createdAt),
}));

export const tradePilotPriceAlerts = pgTable("tp_price_alert", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  analysisId: text("analysis_id").notNull().references(() => tradePilotAnalyses.id, { onDelete: "cascade" }),
  mode: text("mode").notNull(),
  side: text("side").notNull(),
  levels: jsonb("levels").$type<string[]>().notNull(),
  channels: jsonb("channels").$type<string[]>().notNull(),
  active: boolean("active").notNull().default(true),
  lastTriggeredLevel: text("last_triggered_level"),
  // level -> ISO timestamp of when that level was hit (per-level status).
  triggeredLevels: jsonb("triggered_levels").$type<Record<string, string>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  activeIdx: index("tp_price_alert_active_idx").on(t.active),
  oneSide: uniqueIndex("tp_price_alert_analysis_side_unique").on(t.analysisId, t.side),
}));

export const tradePilotPerformanceSnapshots = pgTable("tp_performance_snapshot", {
  mode: text("mode").notNull(),
  instrumentId: text("instrument_id").notNull().default("*"),
  timeframe: text("timeframe").notNull(),
  sample: integer("sample").notNull().default(0),
  stillValid: integer("still_valid").notNull().default(0),
  expired: integer("expired").notNull().default(0),
  stopLoss: integer("stop_loss").notNull().default(0),
  takeProfitOne: integer("tp1").notNull().default(0),
  takeProfitTwo: integer("tp2").notNull().default(0),
  winRate: integer("win_rate"),
  completion: integer("completion"),
  minimumSamples: integer("minimum_samples"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.mode, t.instrumentId, t.timeframe] }),
}));

export const tradePilotTradingPlans = pgTable("tp_trading_plan", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  analysisId: text("analysis_id").notNull().references(() => tradePilotAnalyses.id, { onDelete: "cascade" }),
  mode: text("mode").notNull(),
  variant: text("variant").notNull(),
  accountType: text("account_type").notNull(),
  tradingCapital: numeric("trading_capital", { precision: 24, scale: 2 }).notNull(),
  lossLimit: numeric("loss_limit", { precision: 24, scale: 2 }).notNull(),
  riskStyle: text("risk_style").notNull(),
  result: jsonb("result").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userAnalysisIdx: index("tp_trading_plan_user_analysis_idx").on(t.userId, t.analysisId, t.createdAt),
}));

// Audit aksi admin konsol TradePilot. Tidak pernah menyimpan email nasabah:
// pencarian via email hanya mencatat userId HMAC hasilnya (bila ketemu).
export const tradePilotAdminAudit = pgTable("tp_admin_audit", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  adminUserId: integer("admin_user_id").notNull(),
  action: text("action").notNull(),
  targetUserId: text("target_user_id"),
  found: boolean("found").notNull().default(false),
  requestId: text("request_id"),
  details: jsonb("details").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  createdIdx: index("tp_admin_audit_created_idx").on(t.createdAt),
  adminIdx: index("tp_admin_audit_admin_idx").on(t.adminUserId, t.createdAt),
}));

// Pengaturan TradePilot yang diubah super_admin (kuota, kill switch).
export const tradePilotSettings = pgTable("tp_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedBy: integer("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Snapshot kesehatan operasional terbaru. Instrumentasi menulis best-effort
// agar kegagalan observability tidak pernah memutus analisis atau background job.
export const tradePilotOperationalHealth = pgTable("tp_operational_health", {
  key: text("key").primaryKey(),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
});

// Event pendek untuk menghitung rasio kegagalan OpenAI/webhook dalam window
// waktu. Retensi dibatasi oleh maintenance job TradePilot.
export const tradePilotOperationalEvents = pgTable("tp_operational_event", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  category: text("category").notNull(),
  success: boolean("success").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  categoryCreatedIdx: index("tp_operational_event_category_created_idx").on(t.category, t.createdAt),
}));

export type TradePilotAnalysis = typeof tradePilotAnalyses.$inferSelect;
export type TradePilotPriceAlert = typeof tradePilotPriceAlerts.$inferSelect;
export type TradePilotTradingPlan = typeof tradePilotTradingPlans.$inferSelect;
