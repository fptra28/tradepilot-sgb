# Trade Pilot v1 API — Referensi Endpoint & Payload (get-sgb)

> **Status:** terbaru per 27 Oktober 2026. Kontrak ini mengikuti dokumen
> **"Requirement API — TradePilot" (15 Okt 2026)** dan diverifikasi terhadap
> `artifacts/api-server/src/routes/trade-pilot.ts`, `src/lib/trade-pilot.ts`,
> dan `src/locales/trade-pilot.ts`. Kontrak mesin:
> [`TRADE_PILOT_V1_OPENAPI.yaml`](./TRADE_PILOT_V1_OPENAPI.yaml).
>
> **Breaking change vs versi 26 Okt:** header `X-Api-Key`/`X-User-Id` diganti
> `Authorization: Bearer`/`X-TradePilot-User`; `/state`, `/history`,
> `/performance`, `/alerts` diganti `/bootstrap`, `/histories`,
> `/performance/timeframes`, `/analyses/{id}/price-alert`. Kode error
> `analysis_unavailable` menjadi `upstream_unavailable`.

---

## 1. Ringkasan endpoint

| # | Method & path | Fungsi | Pengganti di FE | Prio |
|---|---|---|---|---|
| 1 | `GET /bootstrap?modes=demo,real` | Kredit + riwayat + analisis terakhir + performa semua mode dalam 1 call; auto-provisioning user | `getTradePilotBootstrap()` | P0 |
| 2 | `GET /credits?mode=` | Saldo kredit | `CreditService.getBalance` | P0 |
| 3 | `POST /analyses` | Jalankan analisis AI, potong 1 kredit | `AnalysisService.run` | P0 |
| 4 | `GET /analyses/latest?mode=` | Analisis terakhir (204 bila belum ada) | `AnalysisService.getLatest` | P0 |
| 5 | `GET /analyses/{id}` | Detail analisis | baru | P1 |
| 6 | `GET /histories?mode=&cursor=&limit=` | Riwayat + status hasil | `HistoryService.list` | P0 |
| 7 | `GET /performance/timeframes?mode=` | Statistik win-rate per timeframe | `STATIC_..._TIMEFRAME_PERFORMANCE` | P0 |
| 8 | `GET /analyses/{id}/indicators` (juga di dalam #3/#5) | Indikator teknikal | konstanta `INDICATORS` | P1 |
| 9 | `GET /fundamental-news?instrumentId=` | Berita fundamental | `copy.fundamentalContext.items` | P1 |
| 10 | `PUT /analyses/{id}/price-alert` (+ `GET`) | Aktif/nonaktif price alert per level | `useState(false)` | P2 |
| 11 | `POST /trading-plans` (+ `GET ?analysisId=`) | Simpan trading plan | tombol "Simpan" | P2 |
| 11b | `POST /analyses/{id}/position-plan` | Hitung Adaptive Position Plan (lot, margin, risiko SL, profit TP, layer) | tombol "Buat rekomendasi" | P1 |
| 12 | `GET /instruments` | Instrumen, timeframe, contract specs | `CLIENT_AREA_TRADE_PILOT_INSTRUMENTS` | P2 |
| – | `GET /candles?instrumentId=&timeframe=` | Candle untuk chart level (pendukung) | – | – |
| – | `GET /indicators?instrumentId=&timeframe=` | Indikator live tanpa analisis (pendukung) | – | – |

---

## 2. Konvensi umum

- **Base URL:** `{TRADE_PILOT_API_BASE_URL}/v1/trade-pilot`. Dipanggil server-to-server saja.
- **Autentikasi service:** `Authorization: Bearer {TRADE_PILOT_API_KEY}` (dibandingkan constant-time).
- **Identitas user:** `X-TradePilot-User: {userId}` — HMAC-SHA256 hex 64 karakter dari `trade-pilot:{email}`. Email/nomor akun ditolak (`400 invalid_request`).
- **Mode:** `demo | real`, dipisah untuk kredit, riwayat, dan hasil terakhir. Header opsional `X-Allowed-Modes: demo,real` → mode lain dibalas `403 access_denied`.
- **Bahasa:** `Accept-Language: id | en` (default `id`) untuk pesan error, `marketContext`, dan `disclaimer`.
- **Idempotensi:** `POST /analyses` wajib `Idempotency-Key` (`^[a-zA-Z0-9-]{8,80}$`). Key sama dalam 24 jam → respons sama, kredit tidak dipotong lagi. Key sama + payload beda → `409`.
- **Request ID:** setiap respons membawa header `X-Request-Id` (meneruskan `X-Request-Id` masuk bila formatnya valid, selain itu dibuat `req_…`).
- **Format:** JSON camelCase, timestamp ISO-8601 UTC, harga berupa string desimal (`"4172.00"`). Objek kredit/analisis/riwayat membawa `source: "api"`.

### Format error

```json
{ "error": { "code": "insufficient_credit", "message": "Kredit tidak cukup.", "requestId": "req_9f2c…" } }
```

| HTTP | `error.code` | Status UI |
|---|---|---|
| 400 | `invalid_request` | invalid_request |
| 401 / 403 | `unauthorized`, `access_denied` | access_denied |
| 402 | `insufficient_credit` | insufficient_credit |
| 404 | `not_found` | – (ID bukan milik user juga 404) |
| 409 | `idempotency_conflict` | invalid_request |
| 429 | `rate_limited` (+ header `Retry-After`) | error + pesan |
| 500 / 503 | `internal_error`, `upstream_unavailable` | error |

---

## 3. Provisioning user otomatis

- Request pertama dengan `X-TradePilot-User` yang belum dikenal membuat baris `tp_user` (hanya `userId`, `createdAt`, `firstSeenMode`, `bootstrappedAt`) — upsert atomik, dua request paralel tetap satu user.
- Saldo kredit per mode dibuat saat mode itu pertama dipakai (unique `userId + mode`).
- GET tidak pernah memotong kredit; pemotongan hanya di `POST /analyses`.
- `GET /bootstrap` mengembalikan `isNewUser: true` **sekali**, pada bootstrap pertama user tersebut.

---

## 4. Detail endpoint

### 4.1 `GET /bootstrap?modes=demo,real`

`modes` opsional (default: semua mode yang diizinkan `X-Allowed-Modes`, atau keduanya).

```json
{
  "isNewUser": true,
  "credits": {
    "demo": { "mode": "demo", "allowance": 5, "consumed": 0, "remaining": 5, "resetsAt": "2026-10-28T00:00:00.000Z", "source": "api" },
    "real": { "mode": "real", "allowance": 50, "consumed": 3, "remaining": 47, "resetsAt": "2026-11-01T00:00:00.000Z", "source": "api" }
  },
  "histories": { "demo": [], "real": [ { "id": "a_…", "createdAt": "2026-10-06T02:00:00.000Z", "instrumentLabel": "XAU/USD", "mode": "real", "status": "take_profit_2", "timeframeLabel": "1h", "resolvedAt": "…", "source": "api" } ] },
  "latestAnalyses": { "demo": null, "real": { "…": "Analysis (lihat 4.3)" } },
  "timeframePerformance": [ { "mode": "demo", "timeframe": "1m", "sample": 0, "…": "lihat 4.7" } ]
}
```

`histories` berisi 20 item terbaru per mode. `timeframePerformance` adalah array; setiap item diberi field `mode` karena satu call bisa memuat dua mode.

### 4.2 `GET /credits?mode=real`

```json
{ "mode": "real", "allowance": 50, "consumed": 3, "remaining": 47, "resetsAt": "2026-11-01T00:00:00.000Z", "source": "api" }
```

Kuota & periode diatur env (`TRADE_PILOT_{DEMO|REAL}_ALLOWANCE`, `TRADE_PILOT_{DEMO|REAL}_CREDIT_PERIOD` = `daily|weekly|monthly`) atau dari dashboard admin. Default demo 5/hari, real 50/bulan. Periode **berjangkar pada tanggal pertama kali nasabah memakai TradePilot**, reset pukul 00:00 WIB: bulanan = tanggal yang sama tiap bulan (tgl 29–31 jatuh ke akhir bulan bila tidak ada), mingguan = tiap 7 hari sejak hari pertama, harian = tiap 00:00 WIB. `resetsAt` selalu dikirim dalam UTC.

### 4.3 `POST /analyses`

Header: `Idempotency-Key`, `X-TradePilot-User`. Body:

```json
{ "instrumentId": "gold", "mode": "real", "timeframe": "60" }
```

`instrumentId`: `gold | brent | hang-seng | nikkei`. `timeframe`: `1 | 5 | 15 | 30 | 60 | 240 | D | W | M`.

Alur: validasi → rate limit → idempotensi → cek kredit → ambil candle & indikator (+ berita & kalender untuk TF ≥ 15m) → AI (atau cache lintas user untuk candle yang sama) → simpan analisis + riwayat (`still_valid`) + audit → potong 1 kredit **dalam transaksi yang sama** → `201`. Gagal di candle/AI → `503 upstream_unavailable`, kredit tidak terpotong.

Respons `201`:

```json
{
  "analysis": {
    "id": "a_mh9k2x1a3f9c0d1e2b3a",
    "analyzedAt": "2026-10-15T03:01:00.000Z",
    "mode": "real",
    "instrumentId": "gold",
    "instrumentLabel": "XAU/USD",
    "timeframe": "60",
    "timeframeLabel": "1h",
    "direction": "neutral",
    "marketSentiment": "bearish",
    "buyLevels":  { "entry": "4172.00", "stopLoss": "4152.00", "takeProfitOne": "4192.00", "takeProfitTwo": "4212.00" },
    "sellLevels": { "entry": "4148.00", "stopLoss": "4168.00", "takeProfitOne": "4128.00", "takeProfitTwo": "4108.00" },
    "validUntil": "2026-10-15T07:01:00.000Z",
    "dataSnapshot": { "price": "4162.35", "candleCount": 13744, "asOf": "2026-10-15T03:00:00.000Z" },
    "indicators": [ { "group": "oscillator", "label": "RSI (14)", "value": "44.87", "status": "buy", "marker": 45 } ],
    "marketContext": { "title": "Konteks Pasar XAU/USD (1h)", "description": "…", "note": "…" },
    "status": "still_valid",
    "resolvedAt": null,
    "disclaimer": "Hasil analisis TradePilot bersifat informasi dan edukasi, bukan ajakan…",
    "source": "api"
  },
  "credit":  { "mode": "real", "allowance": 50, "consumed": 4, "remaining": 46, "resetsAt": "2026-11-01T00:00:00.000Z", "source": "api" },
  "history": { "id": "a_mh9k2x1a3f9c0d1e2b3a", "createdAt": "2026-10-15T03:01:00.000Z", "instrumentLabel": "XAU/USD", "mode": "real", "status": "still_valid", "timeframeLabel": "1h", "resolvedAt": null, "source": "api" }
}
```

Catatan field:
- `confidence` (opsional, `null` untuk analisis lama): penjelasan keyakinan dari output AI tersimpan — `{ min, max, riskLevel: low|medium|high|null, reason, technical, fundamental, risk, invalidation: string[], sources: { news: string[], calendar: [{ name, date }] } }`. Narasi berasal dari model (Bahasa Indonesia). Dipakai modal "Kenapa keyakinan tidak lebih tinggi?" di get-sgb.
- `history.id === analysis.id`.
- `direction` dari `tradePlan.preferredSide` AI (`buy→bullish`, `sell→bearish`, `wait→neutral`); `marketSentiment` dari mayoritas indikator.
- `validUntil` = waktu generate + masa berlaku per TF: 1m 4 menit, 5m 20 menit, 15m 1 jam, 30m 2 jam, 1h 4 jam, 4h 16 jam, 1D 4 hari, 1W 28 hari, 1M 120 hari.
- `marketContext` dalam bahasa `Accept-Language`. Versi `id` memakai narasi AI; versi `en` disusun dari field terstruktur (kondisi pasar, risiko, tally indikator) karena model menulis dalam Bahasa Indonesia.
- Replay idempotensi mengembalikan analisis yang sama dalam bahasa request saat ini, dengan `credit`/`history` seperti saat pertama dibuat.

### 4.4 `GET /analyses/latest?mode=real`

`200` dengan objek `Analysis`, atau `204 No Content` bila belum pernah ada.

### 4.5 `GET /analyses/{id}`

Objek `Analysis` lengkap. ID milik user lain → `404 not_found` (bukan 403).

### 4.6 `GET /histories`

Query: `mode` (wajib), `limit` (default 20, maks 100), `cursor`, opsional `instrumentId`, `timeframe`, `status`. Urut `createdAt` terbaru.

```json
{ "items": [ { "id": "a_…", "createdAt": "…", "instrumentLabel": "XAU/USD", "mode": "real", "timeframeLabel": "1h", "status": "stop_loss", "resolvedAt": "…", "source": "api" } ], "nextCursor": "WyIyMDI2LTEw…" }
```

Item riwayat juga memuat ringkasan untuk kartu (tambahan, klien lama boleh mengabaikan):
`instrumentId`, `timeframe`, `direction` (`bullish`/`bearish`/`neutral`), `priceAtAnalysis`,
`activeSide` (`buy`/`sell` bila entry sudah tersentuh, selain itu `null`), `buyLevels`, `sellLevels`, `validUntil`.

Status dievaluasi job tiap 1 menit terhadap harga live:

| Status | Arti |
|---|---|
| `still_valid` | Belum menyentuh SL/TP dan belum lewat `validUntil` |
| `take_profit_1` | TP1 tersentuh lalu `validUntil` lewat tanpa TP2/SL |
| `take_profit_2` | TP2 tersentuh |
| `stop_loss` | SL tersentuh |
| `expired` | Lewat `validUntil` tanpa target tersentuh |
| `invalid` | Dicadangkan (belum dipakai evaluator) |

### 4.7 `GET /performance/timeframes?mode=real`

Agregat **global per mode** (seluruh nasabah), dihitung ulang tiap 15 menit. Opsional `instrumentId`.

```json
[ { "timeframe": "1h", "sample": 42, "stillValid": 1, "expired": 0, "stopLoss": 7, "takeProfitOne": 0, "takeProfitTwo": 3, "winRate": 30, "completion": 98, "minimumSamples": null } ]
```

- `winRate = (TP1 + TP2) / (TP1 + TP2 + SL) × 100` (dibulatkan); `null` bila sampel selesai < 10 atau belum ada TP/SL.
- `completion = sampel selesai / sample × 100`.
- `minimumSamples` = sampel selesai tambahan yang masih dibutuhkan (ambang 10), `null` bila sudah cukup.
- Timeframe: `1m, 5m, 15m, 30m, 1h, 4h, 1D, 1W, 1M`.

### 4.8 `GET /analyses/{id}/indicators`

```json
{ "analysisId": "a_…", "calculatedAt": "2026-10-15T03:00:00.000Z", "items": [ { "group": "movingAverage", "label": "EMA (9)", "value": "4160.00", "status": "buy", "marker": 25 } ] }
```

`group`: `oscillator | movingAverage`; `status`: `buy | sell | neutral`; `marker`: 0–100. Set: RSI(14), MACD(12,26), Stochastic %K, Bollinger, dan moving average dari engine indikator.

### 4.9 `GET /fundamental-news?instrumentId=gold&limit=5`

```json
{ "instrumentId": "gold", "items": [ { "id": "…", "title": "…", "source": "Newsmaker.id", "url": "https://…", "publishedAt": "…", "language": "id" } ] }
```

Sumber: Newsmaker.id (`language: "id"`) dan Yahoo Finance (`"en"`), diurutkan relevansi. `impact` belum diisi. `limit` maks 10. `Cache-Control: private, max-age=300`.

### 4.10 `PUT /analyses/{id}/price-alert`

```json
{ "enabled": true, "levels": ["entry", "stopLoss", "takeProfitOne", "takeProfitTwo"], "channels": ["push"] }
```

`levels` default semua; `channels`: `push | email | whatsapp` (default `push`). Mengaktifkan butuh analisis `still_valid` (selain itu `400`). Sebelum entry tersentuh alert memantau skenario buy **dan** sell; setelah satu sisi aktif, sisi lain dinonaktifkan. `enabled: false` menonaktifkan semuanya. `GET` path yang sama mengembalikan state yang sama.

```json
{
  "analysisId": "a_…",
  "enabled": true,
  "channels": ["push"],
  "levels": [
    { "level": "entry", "status": "triggered", "side": "buy", "triggeredAt": "2026-10-15T04:10:00.000Z" },
    { "level": "stopLoss", "status": "pending", "side": null, "triggeredAt": null }
  ],
  "updatedAt": "2026-10-15T04:10:00.000Z"
}
```

Status per level: `pending | triggered | cancelled` (cancelled = alert dimatikan atau analisis sudah selesai sebelum level tersentuh). Pengiriman notifikasi lewat webhook (bagian 5).

### 4.11 `POST /trading-plans`

```json
{ "analysisId": "a_…", "variant": "buy", "accountType": "mini", "tradingCapital": "1000.00", "lossLimit": "250.00", "riskStyle": "50", "result": { "lot": "0.10", "margin": "100.00" } }
```

`accountType`: `micro | mini | regular`; `tradingCapital`/`lossLimit` string atau angka desimal (maks 2 desimal); `riskStyle` string ≤ 32 karakter; `result` objek bebas hasil kalkulasi FE (≤ 8 KB). Mode diambil dari analisis. Respons `201`:

```json
{ "id": "tp_…", "analysisId": "a_…", "mode": "demo", "variant": "buy", "accountType": "mini", "tradingCapital": "1000.00", "lossLimit": "250.00", "riskStyle": "50", "result": { "lot": "0.10", "margin": "100.00" }, "createdAt": "…" }
```

`GET /trading-plans?analysisId=a_…` → `{ "items": [TradingPlan] }`.

### 4.11b `POST /analyses/{id}/position-plan`

Menghitung **Adaptive Position Plan** untuk analisis milik user. **Tidak memotong kredit.**
Arah & level harga berasal dari analisis AI yang tersimpan; lot, margin, risiko di Stop Loss,
profit TP1/TP2, dan layer entry dihitung **deterministik** dari TP Standard Trading Rules
(`GET /instruments` → `rulesVersion`). AI tidak menghasilkan angka uang.

Body:

```json
{ "accountType": "mini", "riskStyle": "conservative", "tradingCapital": 1000, "lossLimit": 800 }
```

- `accountType`: `micro` | `mini` | `regular`
- `riskStyle`: `conservative` | `balanced` | `aggressive`
- `tradingCapital` (dana trading, USD) dan `lossLimit` (batas rugi maksimal, USD) > 0; `lossLimit` tidak boleh melebihi `tradingCapital` (jika lebih, `valid: false`).

Respons (ringkas):

```json
{
  "analysisId": "a_…", "accountType": "mini", "riskStyle": "conservative", "rulesVersion": "2026.02",
  "valid": true, "errors": [], "assumptions": [],
  "decision": { "posture": "entry_only", "preferredSide": "buy", "reasonCodes": ["low_confidence", "trend_favors_buy"] },
  "recommendation": { "initialLot": 0.2, "usableRiskBudget": 300, "riskUtilizationRate": 0.375, "maximumLoss": 800, "marginBudget": 1000, "riskStyle": "conservative" },
  "rule": { "contractSize": 10, "marginPerLot": 1000, "minimumLot": 0.1, "maximumLot": 0.9, "lotStep": 0.1 },
  "buy": { "entry": 4162.35, "stopLoss": 4148, "takeProfit1": 4180, "takeProfit2": 4195, "totalLots": 0.2, "marginRequired": 200, "estimatedCycleLoss": 287, "profitToTakeProfit1": 353, "profitToTakeProfit2": 653, "ladder": [ … ] },
  "sell": null,
  "sideEvaluations": { "buy": { "status": "viable", "diagnostic": null }, "sell": { "status": "not_aligned", "diagnostic": { … } } },
  "tiers": { "micro": { "valid": true, … }, "mini": { … }, "regular": { "valid": false, … } },
  "disclaimer": "…"
}
```

- `decision.posture`: `scaling_allowed` (boleh tambah layer), `entry_only` (hanya entry awal), `not_recommended`.
- Analisis yang sudah selesai (TP/SL/kedaluwarsa) → `valid: false`, `posture: not_recommended` (perlu analisis ulang).
- Angka uang dalam USD, dibulatkan 4 desimal.
- Layer tambahan diambil dari tepi **zona entry asli AI** (bila titik tengahnya sama dengan entry tersimpan) dan dari swing candle terbaru di antara entry dan SL; maksimal 2 layer.

### 4.12 `GET /instruments`

```json
{
  "rulesVersion": "2026.02",
  "items": [
    {
      "id": "gold",
      "label": "XAU/USD",
      "quoteSymbols": ["XUL10"],
      "tradingViewSymbol": "OANDA:XAUUSD",
      "timeframes": [ { "value": "1", "label": "1m" }, { "value": "60", "label": "1h" } ],
      "contractSpecs": {
        "micro":   { "lot": "0.01", "contractSize": 1,   "contractUnit": "troy ounce", "margin": "10.00",   "marginCurrency": "USD", "marginSource": "derived_from_contract_size" },
        "mini":    { "lot": "0.10", "contractSize": 10,  "contractUnit": "troy ounce", "margin": "100.00",  "marginCurrency": "USD", "marginSource": "broker_document" },
        "regular": { "lot": "1.00", "contractSize": 100, "contractUnit": "troy ounce", "margin": "1000.00", "marginCurrency": "USD", "marginSource": "derived_from_contract_size" }
      }
    }
  ]
}
```

`margin` = initial margin per 1 lot (USD). Hanya angka Mini yang berasal dari dokumen trading rules broker; Micro/Regular diskalakan menurut contract size dan **perlu dikonfirmasi** tim produk. `Cache-Control: private, max-age=3600`.

---

## 5. Webhook alert (backend → get-sgb)

Dikirim hanya jika `TRADE_PILOT_ALERT_WEBHOOK_URL` diisi. Satu `POST` per alert yang cocok, timeout 5 detik, tanpa retry.

```http
POST <TRADE_PILOT_ALERT_WEBHOOK_URL>
Content-Type: application/json
X-Api-Key: <TRADE_PILOT_ALERT_WEBHOOK_API_KEY>
```

```json
{ "alertId": "al_…", "userId": "3f1c…e9a0", "analysisId": "a_…", "mode": "demo", "instrumentId": "gold", "side": "buy", "level": "takeProfitOne", "price": "4175.20", "channels": ["push"], "triggeredAt": "2026-10-27T05:12:00.000Z" }
```

`userId` adalah `X-TradePilot-User` opaque yang sama; BFF memetakan balik ke nasabah dan memilih kanal pengiriman.

---

## 6. Kebutuhan non-fungsional — implementasi

| Aspek | Implementasi |
|---|---|
| Rate limit | Maks 1 analisis berjalan & 10 analisis/menit per user (`TRADE_PILOT_MAX_CONCURRENT_ANALYSES`, `TRADE_PILOT_MAX_ANALYSES_PER_MINUTE`). In-memory per proses — pakai store bersama (Redis) bila API dijalankan multi-replika. |
| Caching AI | Hasil AI di-cache per `instrumentId + timeframe + waktu candle terakhir`, maksimal 1 candle (≤ 1 jam), dibagi lintas user; kredit tetap dipotong per user. Matikan dengan `TRADE_PILOT_AI_CACHE=off`. |
| Konsistensi kredit | Advisory lock per user+mode, `consumed < allowance` di UPDATE, dan insert analisis + potong kredit + simpan idempotensi dalam satu transaksi. |
| Audit | `tp_analysis` menyimpan `model`, `prompt_version` (fingerprint SHA-256 system prompt), `ai_input` (konteks indikator/berita/harga), `ai_output` mentah, `request_id`. Tidak ada job yang menghapus `tp_analysis`; kebijakan retensi DB/backup harus ≥ 5 tahun. |
| Biaya AI | Per analisis: `prompt_tokens`, `completion_tokens`, `total_tokens`, `estimated_cost_usd`, `ai_cache_hit`; juga log `trade_pilot.analysis.created`. Per user: agregasi SQL `GROUP BY user_id`. |
| Kepatuhan | Setiap `Analysis` membawa `disclaimer` ID/EN. **Teks wajib direview tim compliance sesuai ketentuan BAPPEBTI.** |
| Observabilitas | `X-Request-Id` di setiap respons dan `requestId` di setiap error. |
| Keamanan | Bearer key constant-time; header `Authorization` di-redact dari log; hanya userId opaque yang disimpan. |
| Job | Evaluasi status tiap 1 menit, agregasi performa tiap 15 menit, reset kredit & bersih idempotensi tiap 1 jam. |

---

## 7. Database

Jalankan berurutan (idempoten, aman diulang):

```text
lib/db/migrations/0001_trade_pilot_v1.sql
lib/db/migrations/0002_trade_pilot_contract_alignment.sql
lib/db/migrations/0003_tp_admin_audit.sql
lib/db/migrations/0004_tp_admin_audit_details.sql
lib/db/migrations/0005_tp_settings.sql
```

0002 menambah tabel `tp_user`, `tp_trading_plan`, kolom snapshot/audit/biaya di `tp_analysis`, dan `triggered_levels` di `tp_price_alert`, plus backfill `tp_user` dari saldo kredit yang sudah ada.

---

## 8. Integrasi chart (candle + garis Entry/SL/TP)

Chart di get-sgb dibentuk dari **dua sumber data**:

| Data | Sumber | Dipakai untuk |
|---|---|---|
| Candle OHLC | `GET /candles?instrumentId=&timeframe=` (6.8) | Badan chart candlestick |
| Garis level | `analysis.buyLevels` / `analysis.sellLevels` / `analysis.direction` dari `POST /analyses`, `GET /analyses/{id}`, `GET /analyses/latest`, atau `latestAnalyses[mode]` di `GET /bootstrap` | Garis horizontal Entry, SL, TP1, TP2 |
| Penanda waktu analisis | `analysis.analyzedAt` | Garis vertikal "AI melihat sampai sini" |

`/candles` tidak memotong kredit dan boleh di-refresh berkala. Gunakan
`instrumentId` dan `timeframe` **yang sama** dengan analisis supaya level dan
candle selaras.

### 9.1 Alur request

```text
Browser (komponen chart)
  └─ GET /api/client-area/trade-pilot/candles?instrumentId=gold&timeframe=60   (proxy BFF, cookie session)
       └─ BFF: validasi session → bentuk X-TradePilot-User → tambah Authorization: Bearer
            └─ GET {TRADE_PILOT_API_URL}/candles?instrumentId=gold&timeframe=60
```

API key **tidak boleh** sampai ke browser, jadi chart selalu mengambil candle
lewat proxy BFF.

### 9.2 Contoh proxy BFF (Next.js App Router)

`app/api/client-area/trade-pilot/candles/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { getClientAreaSession } from "@/lib/session";       // sesuaikan dengan get-sgb
import { tradePilotUserId } from "@/lib/trade-pilot-user-id"; // HMAC 64 hex

const INSTRUMENTS = new Set(["gold", "brent", "hang-seng", "nikkei"]);
const TIMEFRAMES = new Set(["1", "5", "15", "30", "60", "240", "D", "W", "M"]);

export async function GET(req: NextRequest) {
  const session = await getClientAreaSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const instrumentId = req.nextUrl.searchParams.get("instrumentId") ?? "";
  const timeframe = req.nextUrl.searchParams.get("timeframe") ?? "";
  if (!INSTRUMENTS.has(instrumentId) || !TIMEFRAMES.has(timeframe)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const url = new URL(`${process.env.TRADE_PILOT_API_URL}/candles`);
  url.searchParams.set("instrumentId", instrumentId);
  url.searchParams.set("timeframe", timeframe);

  const upstream = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.TRADE_PILOT_API_KEY!}`,
      "X-TradePilot-User": tradePilotUserId(session.email),
      "Accept-Language": "id",
    },
    cache: "no-store",
  });

  const body = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    // Komponen chart membaca `error` sebagai STRING. Ratakan objek error v1
    // { error: { code, message } } menjadi { error: "<message>" }.
    const message = body?.error?.message ?? `HTTP ${upstream.status}`;
    return NextResponse.json({ error: message }, { status: upstream.status });
  }
  return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
}
```

### 9.3 Memetakan respons v1 ke garis chart

| Field v1 | Garis di chart | Warna |
|---|---|---|
| `buyLevels.entry` | `BUY Entry` | cyan `#06b6d4` |
| `sellLevels.entry` | `SELL Entry` | amber `#f59e0b` |
| `*.stopLoss` | `SL` | merah `#ef4444` |
| `*.takeProfitOne` | `TP1` | hijau `#10b981` |
| `*.takeProfitTwo` | `TP2` | hijau `#10b981` |

### 9.4 Komponen chart TradingView siap pakai

Chart memakai **TradingView Lightweight Charts** (`lightweight-charts@^5`).
Salin [`docs/examples/trade-pilot-levels-chart.tsx`](examples/trade-pilot-levels-chart.tsx)
ke get-sgb, pasang dependensinya, lalu render:

```tsx
<TradePilotLevelsChart
  instrumentId="gold"
  timeframe="60"
  analysis={analysis}   // objek analisis dari POST /analyses atau GET /analyses/{id}
/>
```

Komponen ini mengambil candle dari proxy BFF (9.2), menggambar garis
Entry/SL/TP1/TP2 sesuai tabel 9.3, memakai garis harga live putus-putus, sumbu
waktu lokal, dan memastikan semua level masuk skala harga.

Sisi yang ditampilkan pertama kali mengikuti `direction`: `bearish` → sisi
**sell**, `bullish`/`neutral` → sisi **buy**. User dapat beralih ke `buy`,
`sell`, atau `both` (pada mode `both`, label menjadi `B-SL`, `S-TP1`, dst.).

Semua level berupa string (`"4160.50"`) → ubah ke `Number(...)` sebelum dipakai
sebagai `price` garis.

### 9.4 Memakai komponen `AnalysisLevelsChart` (SGB-TP)

Komponen sudah tersedia di
`artifacts/ai-trading/src/components/analysis-levels-chart.tsx` dan menerima
respons v1 secara langsung:

```tsx
<AnalysisLevelsChart
  instrument={analysis.instrumentLabel}          // label tampilan, mis. "XAU/USD"
  timeframe={analysis.timeframeLabel}            // mis. "1h"
  candlesUrl={`/api/client-area/trade-pilot/candles?instrumentId=${analysis.instrumentId}&timeframe=${analysis.timeframe}`}
  tradePilotAnalysis={{
    direction: analysis.direction,
    buyLevels: analysis.buyLevels,
    sellLevels: analysis.sellLevels,
  }}
  analysisCreatedAt={analysis.analyzedAt}
  height={320}
/>
```

| Prop | Wajib | Keterangan |
|---|---|---|
| `instrument`, `timeframe` | Ya | Dipakai sebagai label; jika `candlesUrl` kosong, dipakai untuk endpoint candle lama `/api/historical/candles` |
| `candlesUrl` | Ya untuk get-sgb | URL proxy BFF. Di-fetch dengan `credentials: "include"` |
| `tradePilotAnalysis` | Ya untuk v1 | `{ direction, buyLevels, sellLevels }` langsung dari respons v1. Dikonversi otomatis lewat `tradePilotV1AnalysisToTradePlan()` |
| `tradePlan` | Tidak | Format lama SGB-TP. Jika diisi, **mengalahkan** `tradePilotAnalysis` |
| `analysisCreatedAt` | Disarankan | Isi dengan `analysis.analyzedAt`; candle setelah waktu ini diredupkan |
| `height` | Tidak | Default `280` |
| `livePrice`, `liveUpdatedAt` | Tidak | Menggerakkan candle terakhir secara live tanpa reset zoom |
| `onLoadFailed` | Tidak | Callback `(reason: string)` jika candle gagal dimuat |

> **Catatan untuk get-sgb:** komponen ini bergantung pada `lightweight-charts`
> serta hook internal SGB-TP (`useTheme`, `useTranslation`). Jika di-copy ke
> get-sgb, ganti dua hook itu dengan versi get-sgb, atau gambar chart sendiri
> dengan `lightweight-charts` memakai pemetaan di 9.3 dan 9.5.

### 9.5 Membuat chart sendiri dengan `lightweight-charts`

```ts
import { createChart, CandlestickSeries, type UTCTimestamp } from "lightweight-charts";

const res = await fetch(`/api/client-area/trade-pilot/candles?instrumentId=gold&timeframe=60`);
const data = await res.json();

const chart = createChart(container, { height: 320 });
const series = chart.addSeries(CandlestickSeries);

series.setData(
  data.candles
    .filter((c: any) => [c.open, c.high, c.low, c.close].every(Number.isFinite))
    .map((c: any) => ({
      time: Math.floor(new Date(c.date).getTime() / 1000) as UTCTimestamp,
      open: c.open, high: c.high, low: c.low, close: c.close,
    })),
);

const side = analysis.direction === "bearish" ? analysis.sellLevels : analysis.buyLevels;
const entryColor = analysis.direction === "bearish" ? "#f59e0b" : "#06b6d4";
[
  { price: side.entry,         title: "Entry", color: entryColor },
  { price: side.stopLoss,      title: "SL",    color: "#ef4444" },
  { price: side.takeProfitOne, title: "TP1",   color: "#10b981" },
  { price: side.takeProfitTwo, title: "TP2",   color: "#10b981" },
].forEach((l) => series.createPriceLine({
  price: Number(l.price), title: l.title, color: l.color, lineWidth: 2, axisLabelVisible: true,
}));
```

(Contoh memakai API `lightweight-charts` v5; di v4 gunakan `chart.addCandlestickSeries()`.)

### 9.6 Hal yang perlu ditangani UI

- **`isStale: true`** → tampilkan badge "data tertunda", terutama jika
  `staleReason = "feed_unavailable"`. Candle tetap boleh digambar.
- **`timeframe = M`** → label analisis `1M`, tetapi candle-nya mingguan
  (`candleTimeframe = "1W"`). Tampilkan granularitas dari `candleTimeframe`.
- **Maksimal 300 candle**; untuk riwayat lebih panjang belum ada paginasi.
- **Level di luar rentang harga** → set autoscale supaya garis SL/TP tetap
  terlihat (komponen SGB-TP sudah melakukan ini).
- **`503 upstream_unavailable`** dari `/candles` → tampilkan state kosong
  dengan tombol coba lagi; level analisis tetap bisa ditampilkan sebagai teks.
- **Refresh**: candle aman di-poll (mis. tiap 30–60 detik untuk intraday);
  status sinyal diperbarui dengan memanggil ulang `GET /analyses/{id}`.

---

### Contoh cepat (cURL)

```bash
BASE=http://localhost:5000/v1/trade-pilot
KEY=$TRADE_PILOT_API_KEY
UID_HEX=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa

# Bootstrap
curl -s "$BASE/bootstrap?modes=demo,real" -H "Authorization: Bearer $KEY" -H "X-TradePilot-User: $UID_HEX"

# Candle untuk chart
curl -s "$BASE/candles?instrumentId=gold&timeframe=60" -H "Authorization: Bearer $KEY" -H "X-TradePilot-User: $UID_HEX"

# Buat analisis
curl -s -X POST "$BASE/analyses" \
  -H "Authorization: Bearer $KEY" -H "X-TradePilot-User: $UID_HEX" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: analysis-$(date +%s)" \
  -d '{"instrumentId":"gold","mode":"demo","timeframe":"60"}'

# Pasang alert
curl -s -X PUT "$BASE/analyses/a_xxx/price-alert" \
  -H "Authorization: Bearer $KEY" -H "X-TradePilot-User: $UID_HEX" -H "Content-Type: application/json" \
  -d '{"enabled":true,"levels":["entry","stopLoss"],"channels":["push"]}'
```
