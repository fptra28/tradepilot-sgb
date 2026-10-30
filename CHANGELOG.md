## [Unreleased] — Web TP jadi konsol admin TradePilot v1 (2026-10-28)

### Added
- Halaman **Kesehatan sistem** untuk admin yang menampilkan freshness feed candle per instrumen/timeframe, rasio kegagalan panggilan OpenAI 24 jam, heartbeat job evaluasi sinyal dan agregasi performa, serta status webhook price alert ke get-sgb; metrik disimpan di tabel observability agar bertahan setelah restart dan tidak lagi hanya tersedia melalui log Docker.
- Tombol darurat analisis di halaman Pengaturan untuk `super_admin`: dapat menjeda analisis secara global atau per mode, instrumen, dan timeframe, menyediakan pesan ID/EN untuk nasabah, berlaku tanpa restart, tidak memotong kredit pada request yang ditolak, serta mencatat setiap perubahan di audit admin.
- Halaman **Pengaturan kuota global** khusus `super_admin` untuk mengubah allowance dan periode reset mode demo/real tanpa restart, melihat sumber/default serta metadata perubahan terakhir, dan secara opsional menerapkan allowance baru ke saldo standar periode berjalan tanpa menimpa penyesuaian manual; penyimpanan memakai konfirmasi dua langkah dan tercatat di audit admin.
- Halaman **Manajemen akun admin** khusus `super_admin` untuk menambah atau mempromosikan admin, mengubah role, mencabut akses sekaligus mengakhiri sesi, dan mereset password; tindakan sensitif memakai konfirmasi dua langkah dan seluruh perubahannya masuk log audit.
- Halaman **Log audit admin** di konsol TradePilot untuk meninjau pencarian email, perubahan kredit, pengaturan, dan pengelolaan akun admin; mencakup filter tindakan/admin/target pengguna, detail perubahan, request ID, serta pagination untuk kebutuhan operasional dan kepatuhan.
- Konsol admin TradePilot v1 (desain netral, ID/EN, dark/light) untuk role `admin` & `super_admin`: **Ringkasan** (KPI pengguna/analisis, biaya AI & rasio cache, tren harian, breakdown status/instrumen/timeframe/mode/arah/model, pemakaian kredit, pengguna paling aktif), **Audit analisis** (filter mode/instrumen/timeframe/status/arah/cache/tanggal/user/ID, detail lengkap dengan level, indikator, konteks pasar, input & output AI, versi prompt, request ID, token, biaya, alert, trading plan), **Pengguna** (userId HMAC, pemakaian kredit per mode, biaya, alert; detail per pengguna), **Kredit & alert** (kebijakan kuota, pengguna kehabisan kredit, daftar price alert aktif/terpicu).
- Pencarian nasabah via email di halaman Pengguna (blind index): `POST /api/admin/trade-pilot/users/lookup` menghitung HMAC email dengan `TRADE_PILOT_USER_ID_SECRET` (harus sama dengan get-sgb) lalu mencocokkan `tp_user`. Email tidak disimpan, tidak masuk URL/log; setiap pencarian dicatat di `tp_admin_audit` (migrasi `0003_tp_admin_audit.sql`). Halaman detail menampilkan email yang dicari secara tersamar dengan tombol Lihat.
- Super admin dapat **reset kredit** (kuota kembali penuh) atau **mengatur sisa kredit** periode berjalan per pengguna & mode di halaman detail pengguna (`POST /api/admin/trade-pilot/users/:userId/credits/:mode`, `requireSuperAdmin`, advisory lock sama dengan pemotongan kredit). Berlaku sampai reset periode berikutnya; dicatat di `tp_admin_audit` dengan nilai sebelum/sesudah (migrasi `0004_tp_admin_audit_details.sql`).
- Objek analisis v1 kini membawa `confidence` (rentang keyakinan, tingkat risiko, alasan Dasar/Batasan, bukti teknikal, konteks fundamental, risiko utama, syarat invalidasi, sumber berita/kalender) dari `ai_output`; `ai_input` kini menyimpan tanggal event kalender (`calendarEventDates`).
- API `GET /api/admin/trade-pilot/{overview,analyses,analyses/:id,users,users/:userId,credits-alerts}` (`requireAdmin`), membaca tabel `tp_*`; `tradePilotCreditPolicy()` diekspor dari `lib/trade-pilot.ts`.

### Changed
- Merombak halaman login web menjadi gerbang konsol admin yang responsif, memperjelas akses khusus `admin`/`super_admin`, dan memfokuskan autentikasi pada kredensial internal.
- Menetapkan palet brand resmi TradePilot pada konsol admin: `Primary 500 #FAB405` untuk brand/action dengan teks gelap, beserta token turunan Primary 50–950 dari handoff desain; chart utama dan focus state kini menggunakan warna sumber yang sama.
- Redesain menyeluruh konsol admin TradePilot menjadi command center operasional berbasis graphite dan aksen emas SGB: shell desktop/mobile baru, drawer responsif, hierarki tipografi, KPI, chart, panel, filter, tabel, form sensitif, detail audit inline, state interaksi, serta palet light/dark yang konsisten. Kontrak API dan struktur data tetap dipertahankan.
- Seluruh halaman web setelah login hanya untuk `admin`/`super_admin`; user biasa melihat halaman "Khusus admin". Login mengarah ke `/admin`, `/` mengarah ke konsol atau login, link pendaftaran dihapus dari halaman login.
- Trade Pilot v1 menerima timeframe `30` (label `30m`, masa berlaku sinyal 2 jam).

### Removed
- Menghapus login Google/Facebook/TikTok dan seluruh ajakan pendaftaran publik dari halaman login web admin; autentikasi native aplikasi tetap tidak berubah.
- Halaman nasabah web lama (landing, register, analyze, history, journal, mirror, progression, topup, guide, profile, notifikasi, dll.) dan halaman admin lama, beserta komponen, hook, util, dan test yang tidak lagi dipakai. Endpoint API backend lama tidak diubah.

## [Unreleased] — Trade Pilot contract alignment (2026-10-27)

### Changed (breaking for any early BFF integration)
- Aligned the Trade Pilot v1 API with "Requirement API — TradePilot" (2026-10-15): service auth is now `Authorization: Bearer`, user identity is `X-TradePilot-User`, every response carries `X-Request-Id`, and errors include `requestId`.
- Replaced `/state`, `/history`, `/performance`, and `/alerts` with `/bootstrap?modes=`, `/histories` (limit 20/100, `instrumentId`/`timeframe`/`status` filters), `/performance/timeframes`, and `PUT|GET /analyses/{id}/price-alert` with per-level `pending`/`triggered`/`cancelled` status.
- Renamed error `analysis_unavailable` to `upstream_unavailable` and added `rate_limited` (429 with `Retry-After`).
- Analysis responses now include `dataSnapshot`, bilingual `marketContext`, a compliance `disclaimer`, `source: "api"`, and indicators with `group: "movingAverage"` (internal `key` removed from output).
- Win rate now follows the requirement formula `(TP1+TP2)/(TP1+TP2+SL)`.
- TradePilot analyses now give the AI related news and economic-calendar context for timeframes of 15m and above.

### Added
- `GET /analyses/latest` (204 when empty), `GET /analyses/{id}/indicators`, `GET /fundamental-news`, `POST|GET /trading-plans`, and `GET /instruments` with contract specs.
- Automatic user provisioning (`tp_user`) with `isNewUser` on the first `/bootstrap`.
- Per-user rate limit (1 concurrent, 10/minute) and a cross-user AI result cache keyed by instrument, timeframe, and latest candle.
- Audit and cost columns on `tp_analysis` (model, prompt fingerprint, AI input/output, tokens, estimated cost, request id).
- Migration `lib/db/migrations/0002_trade_pilot_contract_alignment.sql` and DB-backed integration tests for the new contract.

## [Unreleased]

### Added
- Added `docs/TRADE_PILOT_V1_FULL_DOCUMENTATION.md`, a single complete Trade Pilot v1 integration document for get-sgb (architecture, authentication, all endpoints and payloads, chart integration, alerts/webhook receiver, BFF client, signal lifecycle, configuration, database schema, deployment, testing, security, troubleshooting, limitations, and checklist).
- Added `docs/TRADE_PILOT_V1_API_REFERENCE.md`, an endpoint-by-endpoint payload reference for the get-sgb BFF (headers, enums, request/response bodies, error codes, webhook payload), verified against the current route and service code.
- Added the authenticated Trade Pilot v1 candle endpoint and reusable frontend adapter for rendering v1 Entry, SL, TP1, and TP2 levels with the existing lightweight chart.
- Added a complete Trade Pilot v1 integration guide covering account flow, authentication, every endpoint, request/response examples, BFF usage, Docker, database migration, background jobs, alert webhooks, security, limitations, and troubleshooting.
- Added the server-to-server Trade Pilot v1 API at `/v1/trade-pilot`, covering state, credits, analyses, history, performance, indicators, and price-alert lifecycle endpoints.
- Added isolated Trade Pilot persistence for opaque user IDs, per-mode periodic credit balances, 24-hour idempotency, analysis outcomes, alerts, and performance snapshots.
- Added an idempotent SQL migration for provisioning all Trade Pilot v1 tables and indexes.
- Added one-minute signal evaluation, hourly credit/idempotency maintenance, 15-minute performance aggregation, and an optional BFF alert webhook.
- Added Indonesian and English API error translations, environment templates, and a dedicated OpenAPI contract for the Trade Pilot integration.
- Added a hardened multi-stage Docker image that builds and serves the TradePilot web application and API as one non-root container.
- Added a Docker Compose stack for the application and PostgreSQL with health checks, persistent database storage, and runtime-only environment configuration.
- Added Docker build exclusions and an example Docker environment file to prevent local credentials and unrelated artifacts from entering the image context.
- Added a non-secret local OpenAI placeholder so the Compose health endpoint can start before optional development credentials are configured; AI requests still require a real key in `.env`.
- Initialized the local Docker PostgreSQL schema and provisioned the requested bootstrap super-admin account for local administration.

### Changed
- Documented the candle response contract, stale-source metadata, monthly-to-weekly candle fallback, and secure BFF chart integration in the API guide and OpenAPI specification.
- Reused the existing AI, live-price, historical-candle, and technical-indicator engines for Trade Pilot v1 analyses while keeping its `demo`/`real` account model isolated from the existing `beginner`/`pro` presentation model.
- Configured the ignored local environment with explicit Docker port, PostgreSQL, public URL, timezone, SSL mode, OpenAI placeholder, and the Trade Pilot v1 server-to-server settings; no credential was added to tracked example files.
- Documented all Trade Pilot v1 backend, BFF, Docker, Replit, credit-period, webhook, and database settings; completed the backend environment template without exposing local secrets.
- Added an ignored API-server-local environment file for direct backend tooling while keeping the tracked `.env.example` credential-free.
- Rebuilt the local Docker application with Trade Pilot v1, applied the five-table migration to local PostgreSQL, and verified both API-key rejection and authenticated performance responses.

### Fixed
- Validated Trade Pilot analysis and alert path IDs before service calls, resolving Express 5 parameter typing and rejecting malformed IDs consistently.
- Allowed an explicit `PGSSLMODE=disable` opt-out for the private local Docker network while retaining strict TLS defaults for production database connections.
- Allowed the exact `PUBLIC_BASE_URL` origin through production CORS (including localhost HTTP), preventing Docker-served JavaScript and CSS assets from returning 500 responses.

### Removed
- None.
