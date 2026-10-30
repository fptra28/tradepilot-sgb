# Trade Pilot v1 — Dokumentasi Lengkap Integrasi get-sgb

> ⚠️ **Kontrak berubah per 27 Oktober 2026.** Endpoint, header, dan payload
> sekarang mengikuti dokumen *Requirement API — TradePilot*. Sumber kebenaran
> terbaru: [`TRADE_PILOT_V1_API_REFERENCE.md`](./TRADE_PILOT_V1_API_REFERENCE.md)
> dan [`TRADE_PILOT_V1_OPENAPI.yaml`](./TRADE_PILOT_V1_OPENAPI.yaml). Bagian
> dokumen ini yang menyebut `X-Api-Key`, `X-User-Id`, `/state`, `/history`,
> `/performance`, `/alerts`, atau `analysis_unavailable` sudah tidak berlaku.


| | |
|---|---|
| **Produk** | Trade Pilot v1 (backend SGB-TP / TradePilot.id) |
| **Konsumen** | BFF Next.js `get-sgb` (Client Area PT Solid Gold Berjangka) |
| **Base path** | `/v1/trade-pilot` |
| **Versi dokumen** | 27 Oktober 2026 |
| **Sumber kebenaran** | `artifacts/api-server/src/routes/trade-pilot.ts`, `src/lib/trade-pilot.ts`, `src/locales/trade-pilot.ts`, `lib/db/migrations/0001_trade_pilot_v1.sql` |

Dokumen ini adalah **satu-satunya rujukan lengkap** untuk mengintegrasikan
Trade Pilot v1 ke get-sgb: arsitektur, autentikasi, seluruh endpoint beserta
payload, chart, price alert & webhook, konfigurasi, database, deployment,
keamanan, troubleshooting, dan checklist. Semua isi sudah diverifikasi terhadap
kode saat ini.

Dokumen terkait (lebih ringkas / mesin):
[`TRADE_PILOT_V1_API_REFERENCE.md`](./TRADE_PILOT_V1_API_REFERENCE.md) ·
[`TRADE_PILOT_V1_OPENAPI.yaml`](./TRADE_PILOT_V1_OPENAPI.yaml) ·
[`TRADE_PILOT_V1_CONFIGURATION.md`](./TRADE_PILOT_V1_CONFIGURATION.md) ·
[`TRADE_PILOT_V1_API_GUIDE.md`](./TRADE_PILOT_V1_API_GUIDE.md)

---

## Daftar isi

1. [Ringkasan & arsitektur](#1-ringkasan--arsitektur)
2. [Quick start (15 menit)](#2-quick-start-15-menit)
3. [Autentikasi & header](#3-autentikasi--header)
4. [Enum & nilai yang valid](#4-enum--nilai-yang-valid)
5. [Format error](#5-format-error)
6. [Objek bersama (schema)](#6-objek-bersama-schema)
7. [Detail endpoint & payload](#7-detail-endpoint--payload)
8. [Integrasi chart](#8-integrasi-chart-candle--garis-entrysltp)
9. [Price alert & webhook](#9-price-alert--webhook)
10. [Contoh klien BFF](#10-contoh-klien-bff)
11. [Siklus hidup sinyal & background job](#11-siklus-hidup-sinyal--background-job)
12. [Konfigurasi environment](#12-konfigurasi-environment)
13. [Database](#13-database)
14. [Deployment: Docker & Replit](#14-deployment-docker--replit)
15. [Testing](#15-testing)
16. [Keamanan](#16-keamanan)
17. [Troubleshooting](#17-troubleshooting)
18. [Batasan versi saat ini](#18-batasan-versi-saat-ini)
19. [Checklist integrasi get-sgb](#19-checklist-integrasi-get-sgb)
20. [Lampiran: peta file kode](#20-lampiran-peta-file-kode)

---

## 1. Ringkasan & arsitektur

Trade Pilot v1 adalah API **server-to-server** yang memberi get-sgb kemampuan
analisis AI untuk instrumen SGB (Gold, Brent, Hang Seng, Nikkei): rencana
trading dua sisi (Buy & Sell) lengkap dengan Entry, Stop Loss, TP1, TP2,
indikator teknikal, chart candle, riwayat, statistik performa, dan price alert.

Prinsip desain:

- **Tanpa akun di SGB-TP.** Tidak ada registrasi, email, password, atau nomor
  akun trading yang dikirim. User diidentifikasi dengan **ID opaque** (HMAC 64
  hex) yang dibentuk BFF.
- **Dua namespace terpisah per user:** `demo` dan `real` — kredit, history, dan
  alert tidak tercampur.
- **Browser tidak pernah memanggil API ini langsung.** Semua lewat BFF get-sgb
  yang memegang API key.
- **Terisolasi dari aplikasi TradePilot.id** (`/api/*`, mode `beginner`/`pro`).
  v1 memakai tabel `tp_*` sendiri, tetapi memakai ulang mesin AI, harga live,
  candle, dan indikator yang sama.

### 1.1 Alur

```text
┌──────────┐   cookie session   ┌──────────────────────┐  X-Api-Key + X-User-Id   ┌──────────────────────────┐
│ Browser  │ ─────────────────▶ │ get-sgb BFF (Next.js)│ ───────────────────────▶ │ SGB-TP /v1/trade-pilot   │
│ (Client  │                    │ • validasi session   │                          │ • kredit, analisis, alert│
│  Area)   │ ◀───────────────── │ • cek akun demo/real │ ◀─────────────────────── │ • OpenAI + feed harga    │
└──────────┘     JSON           │ • bentuk ID opaque   │          JSON            │ • job evaluator 1 menit  │
                                └──────────▲───────────┘                          └────────────┬─────────────┘
                                           │        webhook alert (opsional)                    │
                                           └────────────────────────────────────────────────────┘
```

### 1.2 Fitur yang dilayani

| Fitur UI get-sgb | Endpoint |
|---|---|
| Membuka halaman Trade Pilot (kredit, hasil terakhir, history, performa) | `GET /state` |
| Badge sisa kredit | `GET /credits` |
| Tombol **Analisa** | `POST /analyses` |
| Halaman detail analisis | `GET /analyses/{id}` |
| Daftar riwayat + "muat lagi" | `GET /history` |
| Statistik akurasi per timeframe | `GET /performance` |
| Panel / gauge indikator | `GET /indicators` |
| Chart candle + garis level | `GET /candles` + data analisis |
| Price alert | `GET/POST /alerts`, `DELETE /alerts/{id}` + webhook |

---

## 2. Quick start (15 menit)

1. **Jalankan backend** (Docker):
   ```powershell
   copy .env.docker.example .env      # isi OPENAI_API_KEY & TRADE_PILOT_API_KEY
   docker compose up -d --build
   ```
2. **Terapkan migrasi** tabel `tp_*`:
   ```powershell
   Get-Content -Raw .\lib\db\migrations\0001_trade_pilot_v1.sql |
     docker compose exec -T db sh -lc 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
   ```
3. **Cek kesehatan:** `GET http://localhost:5000/api/healthz` → `{"status":"ok"}`.
4. **Uji API key:**
   ```bash
   curl "http://localhost:5000/v1/trade-pilot/credits?mode=demo" \
     -H "X-Api-Key: $TRADE_PILOT_API_KEY" \
     -H "X-User-Id: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
   ```
   Hasil: `{"mode":"demo","allowance":5,"consumed":0,"remaining":5,...}`.
5. **Set env get-sgb** (server-only): `TRADE_PILOT_API_URL`, `TRADE_PILOT_API_KEY`,
   `CLIENT_AREA_SESSION_SECRET` — lalu buat route proxy `/api/client-area/trade-pilot/*`
   (contoh di [§10](#10-contoh-klien-bff) dan [§8.2](#82-contoh-proxy-bff-nextjs-app-router)).

---

## 3. Autentikasi & header

```text
Lokal / Docker : http://localhost:5000/v1/trade-pilot
Dari container get-sgb ke host : http://host.docker.internal:5000/v1/trade-pilot
```

API ini **server-to-server**. Hanya BFF get-sgb yang boleh memanggilnya;
browser memanggil proxy BFF (mis. `/api/client-area/trade-pilot/...`).

| Header | Wajib | Format | Keterangan |
|---|---|---|---|
| `X-Api-Key` | Ya | string | Harus sama persis dengan `TRADE_PILOT_API_KEY` di backend (dibandingkan *timing-safe*). Salah/kosong → `401`. Jika env backend kosong, **semua** request `401`. |
| `X-User-Id` | Ya | `^[a-f0-9]{64}$` (case-insensitive) | ID opaque user (HMAC-SHA256 hex). Disimpan dalam huruf kecil. Tidak valid → `400 invalid_request`. |
| `X-Allowed-Modes` | Disarankan | `demo`, `real`, atau `demo,real` | Jika dikirim dan `mode` request tidak tercantum → `403 access_denied`. Jika tidak dikirim, semua mode diizinkan. |
| `Accept-Language` | Opsional | `id` / `en-...` | Diawali `en` → pesan error bahasa Inggris; selain itu bahasa Indonesia. |
| `Idempotency-Key` | Ya, khusus `POST /analyses` | `^[a-zA-Z0-9-]{8,80}$` | Lihat §3.3 dan §7.3. |
| `Content-Type` | Ya, untuk `POST` | `application/json` | Tanpa header ini body tidak terbaca → `400`. |

Urutan validasi: API key → `X-User-Id` → parameter/body → `X-Allowed-Modes` → logika bisnis.

### 3.1 Membentuk `X-User-Id`

Gunakan HMAC-SHA256 yang **stabil** (input dan secret yang sama selalu
menghasilkan ID yang sama). Email/identitas asli tidak pernah dikirim ke SGB-TP.

```ts
import { createHmac } from "node:crypto";

export function tradePilotUserId(email: string): string {
  return createHmac("sha256", process.env.CLIENT_AREA_SESSION_SECRET!)
    .update(`trade-pilot:${email.trim().toLowerCase()}`)
    .digest("hex"); // 64 karakter hex
}
```

> **Penting:** jika `CLIENT_AREA_SESSION_SECRET` diganti, semua user akan
> mendapat ID baru → kredit, history, dan alert lama tidak terlihat lagi.
> Gunakan secret khusus yang tidak dirotasi bersama session secret, atau
> siapkan migrasi ID.
>
> HMAC bersifat satu arah. Agar webhook alert (§9) bisa diteruskan ke user yang
> benar, BFF perlu **menyimpan pemetaan** `tradePilotUserId → user` saat ID
> pertama kali dibentuk.

### 3.2 `X-Allowed-Modes`

Bentuk dari hasil pengecekan akun trading user di get-sgb, **bukan** dari input
browser. Contoh: user hanya punya akun demo → `X-Allowed-Modes: demo`; request
`mode=real` akan ditolak `403 access_denied`.

### 3.3 `Idempotency-Key` (khusus `POST /analyses`)

- 8–80 karakter, hanya huruf, angka, dan `-` (underscore/spasi ditolak).
- Buat **key baru per klik tombol Analisa**, dan **pakai key yang sama saat
  retry** request tersebut (timeout, jaringan putus) supaya kredit tidak
  terpotong dua kali.
- Berlaku 24 jam per `X-User-Id`. Contoh: `analysis-${crypto.randomUUID()}`.

### 3.4 Timeout yang disarankan di BFF

| Jenis | Timeout |
|---|---|
| Read (`/state`, `/credits`, `/history`, `/performance`, `/indicators`, `/candles`, `/alerts`) | 10 detik |
| `POST /analyses` (memanggil AI) | 30 detik |

---

## 4. Enum & nilai yang valid

### `mode`
| Nilai | Kredit default | Periode reset default (UTC) | Env |
|---|---|---|---|
| `demo` | 5 | `daily` | `TRADE_PILOT_DEMO_ALLOWANCE`, `TRADE_PILOT_DEMO_CREDIT_PERIOD` |
| `real` | 50 | `monthly` | `TRADE_PILOT_REAL_ALLOWANCE`, `TRADE_PILOT_REAL_CREDIT_PERIOD` |

Periode: `daily` (00:00 UTC), `weekly` (Senin 00:00 UTC), `monthly` (tanggal 1, 00:00 UTC).

### `instrumentId`
| Nilai | `instrumentLabel` | Simbol engine internal |
|---|---|---|
| `gold` | `XAU/USD` | XAU/USD |
| `brent` | `BCO` | BRENT |
| `hang-seng` | `HKK` | HSI |
| `nikkei` | `JPK` | NIKKEI |

### `timeframe`
| Nilai request | `timeframeLabel` | Candle yang dipakai (`candleTimeframe`) | Masa berlaku sinyal (`validUntil`) |
|---|---|---|---|
| `1` | `1m` | `1m` | 4 menit |
| `5` | `5m` | `5m` | 20 menit |
| `15` | `15m` | `15m` | 1 jam |
| `60` | `1h` | `1h` | 4 jam |
| `240` | `4h` | `4h` | 16 jam |
| `D` | `1D` | `1D` | 4 hari |
| `W` | `1W` | `1W` | 28 hari |
| `M` | `1M` | **`1W`** (belum ada candle bulanan) | 120 hari |

### `status` analisis
| Nilai | Arti |
|---|---|
| `still_valid` | Masih aktif, dievaluasi tiap 1 menit |
| `take_profit_1` | TP1 tersentuh lalu sinyal kedaluwarsa tanpa SL/TP2 |
| `take_profit_2` | TP2 tersentuh |
| `stop_loss` | SL tersentuh |
| `expired` | Lewat `validUntil` tanpa TP |
| `invalid` | Dicadangkan; saat ini belum diset oleh evaluator |

### Nilai lain
| Field | Nilai |
|---|---|
| `direction` | `bullish` \| `bearish` \| `neutral` (dari sisi yang dipilih AI) |
| `marketSentiment` | `bullish` \| `bearish` (mayoritas sinyal indikator; seri = `bullish`) |
| `side` | `buy` \| `sell` |
| `levels` (alert) | `entry` \| `stopLoss` \| `takeProfitOne` \| `takeProfitTwo` |
| `channels` (alert) | `push` |
| Indikator `status` | `buy` \| `sell` \| `neutral` |
| Indikator `group` | `oscillator` \| `moving_average` |

---

## 5. Format error

Semua error memakai bentuk yang sama:

```json
{
  "error": {
    "code": "insufficient_credit",
    "message": "Kredit untuk mode akun ini sudah habis"
  }
}
```

| HTTP | `code` | Pesan (ID) | Pesan (EN) | Penyebab umum |
|---|---|---|---|---|
| 400 | `invalid_request` | Parameter permintaan tidak valid | The request parameters are invalid | Enum salah, `X-User-Id` bukan 64 hex, `Idempotency-Key` tidak valid, body bukan JSON |
| 401 | `unauthorized` | API key tidak valid | The API key is invalid | `X-Api-Key` salah/kosong, env backend belum diisi |
| 402 | `insufficient_credit` | Kredit untuk mode akun ini sudah habis | No credit remains for this account mode | `remaining = 0` |
| 403 | `access_denied` | Akses ke mode akun ditolak | Access to this account mode was denied | `mode` tidak ada di `X-Allowed-Modes` |
| 404 | `not_found` | Data Trade Pilot tidak ditemukan | The Trade Pilot resource was not found | ID tidak ada / milik user lain / path tidak dikenal |
| 409 | `idempotency_conflict` | Idempotency key sudah digunakan untuk permintaan berbeda | The idempotency key was used for a different request | Key sama, payload berbeda (dalam 24 jam) |
| 500 | `internal_error` | Layanan Trade Pilot sedang mengalami gangguan | The Trade Pilot service is temporarily unavailable | Error tak terduga (lihat log server) |
| 503 | `analysis_unavailable` | Mesin analisis atau data harga sedang tidak tersedia | The analysis engine or price data is unavailable | Feed harga/indikator kosong, OpenAI gagal, level AI tidak lengkap |

### 5.1 Saran pesan UI

| `code` | Tampilan ke user | Aksi UI |
|---|---|---|
| `insufficient_credit` | "Kredit analisis habis, reset pada {resetsAt}" | Nonaktifkan tombol Analisa, tampilkan waktu reset |
| `access_denied` | "Mode akun ini belum tersedia untuk Anda" | Arahkan ke pembukaan akun real/demo |
| `analysis_unavailable` | "Data pasar sedang tidak tersedia, coba lagi" | Tombol coba lagi (pakai `Idempotency-Key` yang sama) |
| `not_found` | "Analisis tidak ditemukan" | Kembali ke history |
| `invalid_request`, `unauthorized`, `idempotency_conflict`, `internal_error` | "Terjadi kesalahan, silakan coba lagi" | Log di BFF — ini bug integrasi, bukan kesalahan user |

---

## 6. Objek bersama (schema)

### 6.1 `Credit`
```json
{
  "mode": "demo",
  "allowance": 5,
  "consumed": 2,
  "remaining": 3,
  "resetsAt": "2026-10-28T00:00:00.000Z"
}
```
| Field | Tipe | Keterangan |
|---|---|---|
| `mode` | `"demo" \| "real"` | |
| `allowance` | integer | Jatah per periode (dari env) |
| `consumed` | integer | Terpakai pada periode berjalan |
| `remaining` | integer | `max(0, allowance - consumed)` |
| `resetsAt` | ISO-8601 (UTC) | Batas akhir periode |

### 6.2 `Levels`
Semua harga dikirim sebagai **string desimal 2 digit**.
```json
{
  "entry": "4160.50",
  "stopLoss": "4148.00",
  "takeProfitOne": "4175.00",
  "takeProfitTwo": "4190.00"
}
```

### 6.3 `IndicatorItem`
```json
{
  "key": "rsi_14",
  "label": "RSI (14)",
  "group": "oscillator",
  "value": "58.42",
  "status": "buy",
  "marker": 58
}
```
| Field | Tipe | Keterangan |
|---|---|---|
| `key` | string | `rsi_14`, `macd_12_26`, `stoch_k`, `bollinger`, lalu MA: `sma_<n>` / `ema_<n>` |
| `label` | string | Teks tampilan |
| `group` | `"oscillator" \| "moving_average"` | |
| `value` | string | RSI/Stoch/MA 2 desimal, MACD 4 desimal, Bollinger `"lower–upper"` |
| `status` | `"buy" \| "sell" \| "neutral"` | |
| `marker` | integer 0–100 | Posisi penanda gauge. Untuk nilai tanpa skala (MACD, MA): buy=25, neutral=50, sell=75 |

Periode MA: intraday (`1`–`240`) → SMA 10/20/50/100 + EMA 9/21/50; harian ke atas
(`D`/`W`/`M`) → SMA 5/10/20/50/100/200 + EMA 10/20/50. MA yang datanya kurang
tidak dikirim, jadi panjang array bisa bervariasi.

### 6.4 `Analysis`
```json
{
  "id": "a_mh8js9e1a1b2c3d4e5f6",
  "instrumentId": "gold",
  "instrumentLabel": "XAU/USD",
  "mode": "demo",
  "timeframe": "60",
  "timeframeLabel": "1h",
  "analyzedAt": "2026-10-27T03:15:00.000Z",
  "validUntil": "2026-10-27T07:15:00.000Z",
  "priceAtAnalysis": "4162.35",
  "direction": "bullish",
  "marketSentiment": "bullish",
  "buyLevels":  { "entry": "4160.50", "stopLoss": "4148.00", "takeProfitOne": "4175.00", "takeProfitTwo": "4190.00" },
  "sellLevels": { "entry": "4172.00", "stopLoss": "4184.50", "takeProfitOne": "4158.00", "takeProfitTwo": "4145.00" },
  "indicators": [ { "key": "rsi_14", "label": "RSI (14)", "group": "oscillator", "value": "58.42", "status": "buy", "marker": 58 } ],
  "status": "still_valid",
  "resolvedAt": null
}
```
| Field | Tipe | Keterangan |
|---|---|---|
| `id` | string | Format `a_<waktu base36><12 hex>` |
| `instrumentId` / `instrumentLabel` | string | Lihat tabel instrumen |
| `mode` | `"demo" \| "real"` | |
| `timeframe` / `timeframeLabel` | string | Lihat tabel timeframe |
| `analyzedAt` | ISO-8601 | Waktu analisis dibuat |
| `validUntil` | ISO-8601 | `analyzedAt` + masa berlaku timeframe |
| `priceAtAnalysis` | string | Harga live saat analisis (fallback: close candle terakhir) |
| `direction` | enum | Sisi yang direkomendasikan AI |
| `marketSentiment` | enum | Mayoritas indikator |
| `buyLevels` / `sellLevels` | `Levels` | Rencana dua sisi |
| `indicators` | `IndicatorItem[]` | Snapshot indikator saat analisis |
| `status` | enum | Lihat tabel status |
| `resolvedAt` | ISO-8601 \| null | Terisi saat status final |

### 6.5 `HistoryItem`
```json
{
  "id": "a_mh8js9e1a1b2c3d4e5f6",
  "createdAt": "2026-10-27T03:15:00.000Z",
  "instrumentLabel": "XAU/USD",
  "mode": "demo",
  "timeframeLabel": "1h",
  "status": "still_valid",
  "resolvedAt": null
}
```

### 6.6 `TimeframePerformance`
```json
{
  "timeframe": "1h",
  "sample": 24,
  "stillValid": 3,
  "expired": 6,
  "stopLoss": 5,
  "takeProfitOne": 4,
  "takeProfitTwo": 6,
  "winRate": 48,
  "completion": 88,
  "minimumSamples": null
}
```
| Field | Tipe | Keterangan |
|---|---|---|
| `timeframe` | string | Label (`1m` … `1M`). Selalu 8 item, urutan `1m,5m,15m,1h,4h,1D,1W,1M` |
| `sample` | integer | Total analisis |
| `stillValid`, `expired`, `stopLoss`, `takeProfitOne`, `takeProfitTwo` | integer | Jumlah per status |
| `winRate` | integer % \| null | `(TP1+TP2) / selesai × 100`. `null` sampai ada ≥ 10 analisis selesai |
| `completion` | integer % \| null | `selesai / sample × 100`. `null` sampai ≥ 10 selesai |
| `minimumSamples` | integer \| null | Sisa analisis selesai yang dibutuhkan; `null` jika sudah cukup |

Snapshot diperbarui **tiap 15 menit** dan bersifat **agregat semua user** per mode (bukan per user).

### 6.7 `Alert`
```json
{
  "id": "al_mh8jt0k2f6e5d4c3b2a1",
  "analysisId": "a_mh8js9e1a1b2c3d4e5f6",
  "side": "buy",
  "levels": ["entry", "takeProfitOne", "stopLoss"],
  "channels": ["push"],
  "active": true,
  "lastTriggeredLevel": null,
  "createdAt": "2026-10-27T03:16:10.000Z"
}
```

---

## 7. Detail endpoint & payload

### 7.0 Ringkasan

| # | Method | Path | Fungsi | Potong kredit | Cek `X-Allowed-Modes` |
|---|---|---|---|---|---|
| 1 | `GET` | `/state` | Snapshot halaman | Tidak | Ya |
| 2 | `GET` | `/credits` | Saldo kredit | Tidak | Ya |
| 3 | `POST` | `/analyses` | Buat analisis AI | **Ya (1)** | Ya |
| 4 | `GET` | `/analyses/{id}` | Detail analisis | Tidak | Tidak |
| 5 | `GET` | `/history` | Riwayat (cursor) | Tidak | Ya |
| 6 | `GET` | `/performance` | Statistik per timeframe | Tidak | Ya |
| 7 | `GET` | `/indicators` | Indikator live | Tidak | – |
| 8 | `GET` | `/candles` | Candle OHLC | Tidak | – |
| 9 | `GET` | `/alerts` | Daftar alert | Tidak | Ya |
| 10 | `POST` | `/alerts` | Buat/perbarui alert | Tidak | Ya |
| 11 | `DELETE` | `/alerts/{id}` | Hapus alert | Tidak | Tidak |

### 7.1 `GET /state`

Snapshot lengkap untuk membuka halaman Trade Pilot dalam satu request. Membuat
saldo kredit otomatis jika user baru.

**Query**

| Param | Wajib | Tipe | Nilai |
|---|---|---|---|
| `mode` | Ya | enum | `demo` \| `real` |

**Request**
```http
GET /v1/trade-pilot/state?mode=demo
X-Api-Key: <TRADE_PILOT_API_KEY>
X-User-Id: 3f1c...e9a0   (64 hex)
X-Allowed-Modes: demo,real
```

**Response `200`**
```json
{
  "mode": "demo",
  "credit": { "mode": "demo", "allowance": 5, "consumed": 1, "remaining": 4, "resetsAt": "2026-10-28T00:00:00.000Z" },
  "latestAnalysis": { "...": "objek Analysis (6.4) atau null jika belum pernah analisis" },
  "history": [ { "...": "maks. 12 HistoryItem (6.5), terbaru dulu" } ],
  "timeframePerformance": [ { "...": "8 item TimeframePerformance (6.6), semua instrumen" } ]
}
```

**Error:** `400`, `401`, `403`, `500`.

---

### 7.2 `GET /credits`

**Query:** `mode` (wajib, `demo` \| `real`).

**Request**
```http
GET /v1/trade-pilot/credits?mode=real
```

**Response `200`** — objek `Credit` (6.1)
```json
{ "mode": "real", "allowance": 50, "consumed": 7, "remaining": 43, "resetsAt": "2026-11-01T00:00:00.000Z" }
```

**Error:** `400`, `401`, `403`, `500`.

---

### 7.3 `POST /analyses`

Membuat analisis AI baru dan memotong **1 kredit** dari mode terkait.

**Header tambahan**

| Header | Wajib | Aturan |
|---|---|---|
| `Idempotency-Key` | Ya | 8–80 karakter, `[a-zA-Z0-9-]`. Berlaku 24 jam per `X-User-Id`. |
| `Content-Type` | Ya | `application/json` |

**Body**

| Field | Wajib | Tipe | Nilai |
|---|---|---|---|
| `instrumentId` | Ya | enum | `gold` \| `brent` \| `hang-seng` \| `nikkei` |
| `mode` | Ya | enum | `demo` \| `real` |
| `timeframe` | Ya | enum (string) | `1` \| `5` \| `15` \| `60` \| `240` \| `D` \| `W` \| `M` |

```http
POST /v1/trade-pilot/analyses
Content-Type: application/json
Idempotency-Key: analysis-550e8400-e29b-41d4
X-Api-Key: <TRADE_PILOT_API_KEY>
X-User-Id: <64 hex>
X-Allowed-Modes: demo,real
```
```json
{
  "instrumentId": "gold",
  "mode": "demo",
  "timeframe": "60"
}
```

> `timeframe` harus **string** (`"60"`, bukan `60`).

**Response `201`**
```json
{
  "analysis": {
    "id": "a_mh8js9e1a1b2c3d4e5f6",
    "instrumentId": "gold",
    "instrumentLabel": "XAU/USD",
    "mode": "demo",
    "timeframe": "60",
    "timeframeLabel": "1h",
    "analyzedAt": "2026-10-27T03:15:00.000Z",
    "validUntil": "2026-10-27T07:15:00.000Z",
    "priceAtAnalysis": "4162.35",
    "direction": "bullish",
    "marketSentiment": "bullish",
    "buyLevels":  { "entry": "4160.50", "stopLoss": "4148.00", "takeProfitOne": "4175.00", "takeProfitTwo": "4190.00" },
    "sellLevels": { "entry": "4172.00", "stopLoss": "4184.50", "takeProfitOne": "4158.00", "takeProfitTwo": "4145.00" },
    "indicators": [
      { "key": "rsi_14", "label": "RSI (14)", "group": "oscillator", "value": "58.42", "status": "buy", "marker": 58 },
      { "key": "macd_12_26", "label": "MACD (12,26)", "group": "oscillator", "value": "1.2741", "status": "buy", "marker": 25 },
      { "key": "stoch_k", "label": "Stochastic %K", "group": "oscillator", "value": "71.30", "status": "neutral", "marker": 71 },
      { "key": "bollinger", "label": "Bollinger", "group": "oscillator", "value": "4140.10–4180.55", "status": "neutral", "marker": 55 },
      { "key": "sma_10", "label": "SMA (10)", "group": "moving_average", "value": "4158.90", "status": "buy", "marker": 25 },
      { "key": "ema_21", "label": "EMA (21)", "group": "moving_average", "value": "4155.12", "status": "buy", "marker": 25 }
    ],
    "status": "still_valid",
    "resolvedAt": null
  },
  "credit": { "mode": "demo", "allowance": 5, "consumed": 2, "remaining": 3, "resetsAt": "2026-10-28T00:00:00.000Z" },
  "history": {
    "id": "a_mh8js9e1a1b2c3d4e5f6",
    "createdAt": "2026-10-27T03:15:00.000Z",
    "instrumentLabel": "XAU/USD",
    "mode": "demo",
    "timeframeLabel": "1h",
    "status": "still_valid",
    "resolvedAt": null
  }
}
```

`history` adalah satu `HistoryItem` yang bisa langsung di-*prepend* ke list
history di UI tanpa memanggil `GET /history` ulang.

**Perilaku idempotency**

| Kondisi | Hasil |
|---|---|
| Key baru | Analisis dibuat, kredit −1, response disimpan 24 jam |
| Key sama + body sama (≤ 24 jam) | `201` dengan **snapshot response yang sama persis**, kredit tidak dipotong lagi |
| Key sama + body berbeda (≤ 24 jam) | `409 idempotency_conflict` |
| Key sama setelah 24 jam | Diperlakukan sebagai request baru |

Request paralel dengan key sama di-serialisasi via advisory lock Postgres per
`userId:mode`, sehingga kredit tidak terpotong dua kali.

**Error:** `400` (body/key tidak valid), `401`, `402` (kredit habis), `403`,
`409`, `503` (feed harga/indikator kosong atau AI gagal — **kredit tidak
dipotong**), `500`.

---

### 7.4 `GET /analyses/{id}`

**Path:** `id` — ID analisis (min. 3 karakter), mis. `a_mh8js9e1a1b2c3d4e5f6`.

```http
GET /v1/trade-pilot/analyses/a_mh8js9e1a1b2c3d4e5f6
```

**Response `200`** — objek `Analysis` (6.4). `status` dan `resolvedAt`
mencerminkan hasil evaluator terkini.

**Error:** `400`, `401`, `404` (tidak ada atau milik `X-User-Id` lain), `500`.

> Endpoint ini **tidak** memeriksa `X-Allowed-Modes`. Jika BFF perlu membatasi,
> cek `analysis.mode` di sisi BFF.

---

### 7.5 `GET /history`

**Query**

| Param | Wajib | Tipe | Default | Aturan |
|---|---|---|---|---|
| `mode` | Ya | enum | – | `demo` \| `real` |
| `limit` | Tidak | integer | `12` | 1–50 |
| `cursor` | Tidak | string | – | Nilai `nextCursor` dari halaman sebelumnya |

```http
GET /v1/trade-pilot/history?mode=demo&limit=12
GET /v1/trade-pilot/history?mode=demo&limit=12&cursor=WyIyMDI2LTEwLTI3VDAzOjE1OjAwLjAwMFoiLCJhX21oOGpzOWUxIl0
```

**Response `200`**
```json
{
  "items": [
    { "id": "a_mh8js9e1a1b2c3d4e5f6", "createdAt": "2026-10-27T03:15:00.000Z", "instrumentLabel": "XAU/USD", "mode": "demo", "timeframeLabel": "1h", "status": "still_valid", "resolvedAt": null },
    { "id": "a_mh7zq2b0f0e1d2c3b4a5", "createdAt": "2026-10-26T09:02:00.000Z", "instrumentLabel": "BCO", "mode": "demo", "timeframeLabel": "15m", "status": "take_profit_2", "resolvedAt": "2026-10-26T09:41:00.000Z" }
  ],
  "nextCursor": "WyIyMDI2LTEwLTI2VDA5OjAyOjAwLjAwMFoiLCJhX21oN3pxMmIwIl0"
}
```

- Urutan: terbaru dulu (`analyzedAt` desc, lalu `id` desc).
- `nextCursor = null` berarti tidak ada halaman berikutnya.
- Cursor adalah base64url opaque — jangan dibentuk manual. Cursor rusak
  diabaikan (kembali ke halaman pertama), bukan error.

**Error:** `400`, `401`, `403`, `500`.

---

### 7.6 `GET /performance`

**Query**

| Param | Wajib | Tipe | Nilai |
|---|---|---|---|
| `mode` | Ya | enum | `demo` \| `real` |
| `instrumentId` | Tidak | enum | Jika kosong → agregat semua instrumen |

```http
GET /v1/trade-pilot/performance?mode=demo&instrumentId=gold
```

**Response `200`** — array 8 `TimeframePerformance` (6.6)
```json
[
  { "timeframe": "1m",  "sample": 0,  "stillValid": 0, "expired": 0, "stopLoss": 0, "takeProfitOne": 0, "takeProfitTwo": 0, "winRate": null, "completion": null, "minimumSamples": 10 },
  { "timeframe": "5m",  "sample": 4,  "stillValid": 1, "expired": 1, "stopLoss": 1, "takeProfitOne": 0, "takeProfitTwo": 1, "winRate": null, "completion": null, "minimumSamples": 7 },
  { "timeframe": "15m", "sample": 0,  "stillValid": 0, "expired": 0, "stopLoss": 0, "takeProfitOne": 0, "takeProfitTwo": 0, "winRate": null, "completion": null, "minimumSamples": 10 },
  { "timeframe": "1h",  "sample": 24, "stillValid": 3, "expired": 6, "stopLoss": 5, "takeProfitOne": 4, "takeProfitTwo": 6, "winRate": 48,   "completion": 88,   "minimumSamples": null },
  { "timeframe": "4h",  "sample": 0,  "stillValid": 0, "expired": 0, "stopLoss": 0, "takeProfitOne": 0, "takeProfitTwo": 0, "winRate": null, "completion": null, "minimumSamples": 10 },
  { "timeframe": "1D",  "sample": 0,  "stillValid": 0, "expired": 0, "stopLoss": 0, "takeProfitOne": 0, "takeProfitTwo": 0, "winRate": null, "completion": null, "minimumSamples": 10 },
  { "timeframe": "1W",  "sample": 0,  "stillValid": 0, "expired": 0, "stopLoss": 0, "takeProfitOne": 0, "takeProfitTwo": 0, "winRate": null, "completion": null, "minimumSamples": 10 },
  { "timeframe": "1M",  "sample": 0,  "stillValid": 0, "expired": 0, "stopLoss": 0, "takeProfitOne": 0, "takeProfitTwo": 0, "winRate": null, "completion": null, "minimumSamples": 10 }
]
```

**Error:** `400`, `401`, `403`, `500`.

---

### 7.7 `GET /indicators`

Indikator teknikal live untuk panel/gauge. Tidak butuh `mode`, tidak memotong kredit.

**Query**

| Param | Wajib | Nilai |
|---|---|---|
| `instrumentId` | Ya | `gold` \| `brent` \| `hang-seng` \| `nikkei` |
| `timeframe` | Ya | `1` \| `5` \| `15` \| `60` \| `240` \| `D` \| `W` \| `M` |

```http
GET /v1/trade-pilot/indicators?instrumentId=gold&timeframe=60
```

**Response `200`**
```json
{
  "instrumentId": "gold",
  "timeframe": "60",
  "calculatedAt": "2026-10-27T03:14:58.120Z",
  "items": [
    { "key": "rsi_14", "label": "RSI (14)", "group": "oscillator", "value": "58.42", "status": "buy", "marker": 58 },
    { "key": "macd_12_26", "label": "MACD (12,26)", "group": "oscillator", "value": "1.2741", "status": "buy", "marker": 25 },
    { "key": "stoch_k", "label": "Stochastic %K", "group": "oscillator", "value": "71.30", "status": "neutral", "marker": 71 },
    { "key": "bollinger", "label": "Bollinger", "group": "oscillator", "value": "4140.10–4180.55", "status": "neutral", "marker": 55 },
    { "key": "sma_10", "label": "SMA (10)", "group": "moving_average", "value": "4158.90", "status": "buy", "marker": 25 },
    { "key": "sma_20", "label": "SMA (20)", "group": "moving_average", "value": "4153.40", "status": "buy", "marker": 25 },
    { "key": "sma_50", "label": "SMA (50)", "group": "moving_average", "value": "4166.75", "status": "sell", "marker": 75 },
    { "key": "sma_100", "label": "SMA (100)", "group": "moving_average", "value": "4120.05", "status": "buy", "marker": 25 },
    { "key": "ema_9", "label": "EMA (9)", "group": "moving_average", "value": "4160.02", "status": "buy", "marker": 25 },
    { "key": "ema_21", "label": "EMA (21)", "group": "moving_average", "value": "4155.12", "status": "buy", "marker": 25 },
    { "key": "ema_50", "label": "EMA (50)", "group": "moving_average", "value": "4149.88", "status": "buy", "marker": 25 }
  ]
}
```

**Error:** `400`, `401`, `503` (data indikator tidak tersedia), `500`.

---

### 7.8 `GET /candles`

Maksimal **300 candle** OHLC terakhir untuk menggambar chart beserta garis
Entry/SL/TP1/TP2. Response dikirim dengan `Cache-Control: private, no-store`.

**Query:** sama dengan `/indicators` (`instrumentId`, `timeframe`).

```http
GET /v1/trade-pilot/candles?instrumentId=gold&timeframe=60
```

**Response `200`**
```json
{
  "instrumentId": "gold",
  "instrumentLabel": "XAU/USD",
  "timeframe": "60",
  "timeframeLabel": "1h",
  "candleTimeframe": "1h",
  "sourceFetchedAt": "2026-10-27T03:00:00.000Z",
  "sourceMaxAgeMs": 300000,
  "isStale": false,
  "staleReason": null,
  "candles": [
    { "date": "2026-10-27T01:00:00.000Z", "open": 4151.10, "high": 4159.80, "low": 4149.20, "close": 4158.20 },
    { "date": "2026-10-27T02:00:00.000Z", "open": 4158.20, "high": 4165.10, "low": 4154.80, "close": 4162.35 }
  ]
}
```

| Field | Tipe | Keterangan |
|---|---|---|
| `candleTimeframe` | string | Granularitas candle **sebenarnya**. Untuk `timeframe=M` bernilai `1W` |
| `sourceFetchedAt` | ISO-8601 | Waktu terakhir sukses mengambil dari sumber upstream |
| `sourceMaxAgeMs` | integer | Batas umur data sebelum dianggap basi |
| `isStale` | boolean | `true` jika data basi atau feed gagal |
| `staleReason` | `"source_age" \| "feed_unavailable" \| null` | Alasan basi |
| `candles[]` | array | `{ date, open, high, low, close }`, angka (bukan string), urut kronologis. Candle terakhir di-*anchor* ke harga live |

**Error:** `400`, `401`, `503` (tidak ada candle), `500`.

---

### 7.9 `GET /alerts`

**Query:** `mode` (wajib).

```http
GET /v1/trade-pilot/alerts?mode=demo
```

**Response `200`** — array `Alert` (6.7), terbaru dulu
```json
[
  {
    "id": "al_mh8jt0k2f6e5d4c3b2a1",
    "analysisId": "a_mh8js9e1a1b2c3d4e5f6",
    "side": "buy",
    "levels": ["entry", "takeProfitOne", "stopLoss"],
    "channels": ["push"],
    "active": true,
    "lastTriggeredLevel": "entry",
    "createdAt": "2026-10-27T03:16:10.000Z"
  }
]
```

`active` menjadi `false` otomatis ketika analisis induknya mencapai status final.

**Error:** `400`, `401`, `403`, `500`.

---

### 7.10 `POST /alerts`

Mendaftarkan price alert pada level analisis. **Upsert** per kombinasi
`(analysisId, side)`: jika sudah ada, `levels`/`channels` ditimpa, `active`
kembali `true`, dan `lastTriggeredLevel` di-reset ke `null`.

**Body**

| Field | Wajib | Tipe | Aturan |
|---|---|---|---|
| `analysisId` | Ya | string | Harus milik `X-User-Id` **dan** `mode` yang sama |
| `mode` | Ya | enum | `demo` \| `real` |
| `side` | Ya | enum | `buy` \| `sell` |
| `levels` | Ya | string[] (min. 1) | `entry`, `stopLoss`, `takeProfitOne`, `takeProfitTwo` |
| `channels` | Ya | string[] (min. 1) | `push` |

```http
POST /v1/trade-pilot/alerts
Content-Type: application/json
```
```json
{
  "analysisId": "a_mh8js9e1a1b2c3d4e5f6",
  "mode": "demo",
  "side": "buy",
  "levels": ["entry", "takeProfitOne", "takeProfitTwo", "stopLoss"],
  "channels": ["push"]
}
```

**Response `201`**
```json
{
  "id": "al_mh8jt0k2f6e5d4c3b2a1",
  "analysisId": "a_mh8js9e1a1b2c3d4e5f6",
  "side": "buy",
  "levels": ["entry", "takeProfitOne", "takeProfitTwo", "stopLoss"],
  "channels": ["push"],
  "active": true,
  "createdAt": "2026-10-27T03:16:10.000Z"
}
```

> Response `POST` **tidak** memuat `lastTriggeredLevel` (selalu `null` setelah
> upsert). Pada upsert, `id` yang dikembalikan adalah ID alert lama.

**Error:** `400`, `401`, `403`, `404` (analisis tidak ditemukan untuk user+mode), `500`.

---

### 7.11 `DELETE /alerts/{id}`

```http
DELETE /v1/trade-pilot/alerts/al_mh8jt0k2f6e5d4c3b2a1
```

**Response `204`** — tanpa body.

**Error:** `400`, `401`, `404` (tidak ada / milik user lain), `500`.

---

## 8. Integrasi chart (candle + garis Entry/SL/TP)

Chart di get-sgb dibentuk dari **dua sumber data**:

| Data | Sumber | Dipakai untuk |
|---|---|---|
| Candle OHLC | `GET /candles?instrumentId=&timeframe=` (7.8) | Badan chart candlestick |
| Garis level | `analysis.buyLevels` / `analysis.sellLevels` / `analysis.direction` dari `POST /analyses`, `GET /analyses/{id}`, atau `latestAnalysis` di `GET /state` | Garis horizontal Entry, SL, TP1, TP2 |
| Penanda waktu analisis | `analysis.analyzedAt` | Garis vertikal "AI melihat sampai sini" |

`/candles` tidak memotong kredit dan boleh di-refresh berkala. Gunakan
`instrumentId` dan `timeframe` **yang sama** dengan analisis supaya level dan
candle selaras.

### 8.1 Alur request

```text
Browser (komponen chart)
  └─ GET /api/client-area/trade-pilot/candles?instrumentId=gold&timeframe=60   (proxy BFF, cookie session)
       └─ BFF: validasi session → bentuk X-User-Id → tambah X-Api-Key
            └─ GET {TRADE_PILOT_API_URL}/candles?instrumentId=gold&timeframe=60
```

API key **tidak boleh** sampai ke browser, jadi chart selalu mengambil candle
lewat proxy BFF.

### 8.2 Contoh proxy BFF (Next.js App Router)

`app/api/client-area/trade-pilot/candles/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { getClientAreaSession } from "@/lib/session";       // sesuaikan dengan get-sgb
import { tradePilotUserId } from "@/lib/trade-pilot-user-id"; // HMAC 64 hex

const INSTRUMENTS = new Set(["gold", "brent", "hang-seng", "nikkei"]);
const TIMEFRAMES = new Set(["1", "5", "15", "60", "240", "D", "W", "M"]);

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
      "X-Api-Key": process.env.TRADE_PILOT_API_KEY!,
      "X-User-Id": tradePilotUserId(session.email),
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

### 8.3 Memetakan respons v1 ke garis chart

| Field v1 | Garis di chart | Warna |
|---|---|---|
| `buyLevels.entry` | `BUY Entry` | cyan `#06b6d4` |
| `sellLevels.entry` | `SELL Entry` | amber `#f59e0b` |
| `*.stopLoss` | `SL` | merah `#ef4444` |
| `*.takeProfitOne` | `TP1` | hijau `#10b981` |
| `*.takeProfitTwo` | `TP2` | hijau `#10b981` |

Sisi yang ditampilkan pertama kali mengikuti `direction`: `bearish` → sisi
**sell**, `bullish`/`neutral` → sisi **buy**. User dapat beralih ke `buy`,
`sell`, atau `both` (pada mode `both`, label menjadi `B-SL`, `S-TP1`, dst.).

Semua level berupa string (`"4160.50"`) → ubah ke `Number(...)` sebelum dipakai
sebagai `price` garis.

### 8.4 Memakai komponen `AnalysisLevelsChart` (SGB-TP)

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
> dengan `lightweight-charts` memakai pemetaan di 8.3 dan 8.5.

### 8.5 Membuat chart sendiri dengan `lightweight-charts`

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

### 8.6 Hal yang perlu ditangani UI

- **`isStale: true`** → tampilkan badge "data tertunda", terutama jika
  `staleReason = "feed_unavailable"`. Candle tetap boleh digambar.
- **`timeframe = M`** → label analisis `1M`, tetapi candle-nya mingguan
  (`candleTimeframe = "1W"`). Tampilkan granularitas dari `candleTimeframe`.
- **Maksimal 300 candle**; untuk riwayat lebih panjang belum ada paginasi.
- **Level di luar rentang harga** → set autoscale supaya garis SL/TP tetap
  terlihat (komponen SGB-TP sudah melakukan ini).
- **`503 analysis_unavailable`** dari `/candles` → tampilkan state kosong
  dengan tombol coba lagi; level analisis tetap bisa ditampilkan sebagai teks.
- **Refresh**: candle aman di-poll (mis. tiap 30–60 detik untuk intraday);
  status sinyal diperbarui dengan memanggil ulang `GET /analyses/{id}`.

---

## 9. Price alert & webhook

### 9.1 Alur alert

```text
1. User pilih level di UI         → BFF: POST /alerts { analysisId, mode, side, levels, channels:["push"] }
2. Evaluator (tiap 1 menit)       → cek harga live vs level analisis
3. Level tersentuh                → alert.lastTriggeredLevel diperbarui
4. Jika WEBHOOK_URL diisi         → backend POST ke BFF (payload di bawah)
5. BFF                            → petakan userId opaque → user → kirim push/notifikasi
6. Analisis final (SL/TP2/expiry) → semua alert analisis itu otomatis active=false
```

Catatan: alert `entry` hanya terpicu sekali — saat sisi aktif (buy/sell)
pertama kali ditentukan. Setelah itu evaluator hanya memantau SL/TP sisi aktif.

### 9.2 Payload webhook

Dikirim hanya jika `TRADE_PILOT_ALERT_WEBHOOK_URL` diisi. Satu `POST` per alert
yang cocok, timeout 5 detik, tanpa retry (kegagalan hanya dicatat di log).

```http
POST <TRADE_PILOT_ALERT_WEBHOOK_URL>
Content-Type: application/json
X-Api-Key: <TRADE_PILOT_ALERT_WEBHOOK_API_KEY>
```
```json
{
  "alertId": "al_mh8jt0k2f6e5d4c3b2a1",
  "userId": "3f1c...e9a0",
  "analysisId": "a_mh8js9e1a1b2c3d4e5f6",
  "mode": "demo",
  "instrumentId": "gold",
  "side": "buy",
  "level": "takeProfitOne",
  "price": "4175.20",
  "channels": ["push"],
  "triggeredAt": "2026-10-27T05:12:00.000Z"
}
```

| Field | Keterangan |
|---|---|
| `userId` | `X-User-Id` opaque yang sama dengan saat analisis dibuat — BFF memetakan balik ke user |
| `level` | `entry` \| `stopLoss` \| `takeProfitOne` \| `takeProfitTwo` |
| `price` | Harga live saat level tersentuh (string 2 desimal) |

BFF sebaiknya memverifikasi `X-Api-Key` dan membalas `2xx` secepat mungkin.

### 9.3 Contoh receiver di get-sgb

`app/api/internal/trade-pilot/alerts/route.ts`

```ts
import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { findUserByTradePilotId } from "@/lib/trade-pilot-user-map"; // tabel pemetaan (§3.1)
import { sendPush } from "@/lib/push";

const LEVEL_LABEL: Record<string, string> = {
  entry: "Entry", stopLoss: "Stop Loss", takeProfitOne: "TP1", takeProfitTwo: "TP2",
};

function validKey(supplied: string | null): boolean {
  const expected = process.env.TRADE_PILOT_ALERT_WEBHOOK_API_KEY ?? "";
  const a = Buffer.from(supplied ?? ""), b = Buffer.from(expected);
  return expected.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!validKey(req.headers.get("x-api-key"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const event = await req.json();
  const user = await findUserByTradePilotId(event.userId);
  if (!user) return new NextResponse(null, { status: 204 }); // user tidak dikenal: abaikan

  // Kirim secara async agar respons < 5 detik (timeout backend)
  void sendPush(user.id, {
    title: `Trade Pilot · ${event.side.toUpperCase()} ${LEVEL_LABEL[event.level] ?? event.level}`,
    body: `Harga ${event.price} menyentuh level ${LEVEL_LABEL[event.level]} (${event.mode})`,
    url: `/client-area/trade-pilot/analyses/${event.analysisId}`,
  });
  return new NextResponse(null, { status: 204 });
}
```

Webhook **tidak di-retry** dan bisa terkirim ganda jika ada lebih dari satu
instance scheduler — buat receiver idempoten (mis. dedupe dengan
`alertId + level`).

---

## 10. Contoh klien BFF

### 10.1 Wrapper TypeScript

`lib/trade-pilot-client.ts`

```ts
import { randomUUID } from "node:crypto";

export type TpMode = "demo" | "real";
export type TpInstrument = "gold" | "brent" | "hang-seng" | "nikkei";
export type TpTimeframe = "1" | "5" | "15" | "60" | "240" | "D" | "W" | "M";

export class TradePilotError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

type Ctx = { userId: string; allowedModes: TpMode[]; lang?: "id" | "en" };

async function tp<T>(ctx: Ctx, path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const res = await fetch(`${process.env.TRADE_PILOT_API_URL}${path}`, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(init.timeoutMs ?? 10_000),
    headers: {
      "X-Api-Key": process.env.TRADE_PILOT_API_KEY!,
      "X-User-Id": ctx.userId,
      "X-Allowed-Modes": ctx.allowedModes.join(","),
      "Accept-Language": ctx.lang ?? "id",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new TradePilotError(res.status, body?.error?.code ?? "unknown", body?.error?.message ?? `HTTP ${res.status}`);
  return body as T;
}

const q = (o: Record<string, string | number | undefined>) =>
  "?" + new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined) as [string, string][]).toString();

export const tradePilot = {
  state:       (c: Ctx, mode: TpMode) => tp(c, `/state${q({ mode })}`),
  credits:     (c: Ctx, mode: TpMode) => tp(c, `/credits${q({ mode })}`),
  analyze:     (c: Ctx, body: { instrumentId: TpInstrument; mode: TpMode; timeframe: TpTimeframe }, idempotencyKey = `analysis-${randomUUID()}`) =>
                 tp(c, "/analyses", { method: "POST", body: JSON.stringify(body), headers: { "Idempotency-Key": idempotencyKey }, timeoutMs: 30_000 }),
  analysis:    (c: Ctx, id: string) => tp(c, `/analyses/${encodeURIComponent(id)}`),
  history:     (c: Ctx, mode: TpMode, limit = 12, cursor?: string) => tp(c, `/history${q({ mode, limit, cursor })}`),
  performance: (c: Ctx, mode: TpMode, instrumentId?: TpInstrument) => tp(c, `/performance${q({ mode, instrumentId })}`),
  indicators:  (c: Ctx, instrumentId: TpInstrument, timeframe: TpTimeframe) => tp(c, `/indicators${q({ instrumentId, timeframe })}`),
  candles:     (c: Ctx, instrumentId: TpInstrument, timeframe: TpTimeframe) => tp(c, `/candles${q({ instrumentId, timeframe })}`),
  alerts:      (c: Ctx, mode: TpMode) => tp(c, `/alerts${q({ mode })}`),
  createAlert: (c: Ctx, body: { analysisId: string; mode: TpMode; side: "buy" | "sell"; levels: ("entry" | "stopLoss" | "takeProfitOne" | "takeProfitTwo")[]; channels: ["push"] }) =>
                 tp(c, "/alerts", { method: "POST", body: JSON.stringify(body) }),
  deleteAlert: (c: Ctx, id: string) => tp<void>(c, `/alerts/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
```

### 10.2 Route proxy yang disarankan di get-sgb

| Route BFF (dipanggil browser) | Diteruskan ke |
|---|---|
| `GET  /api/client-area/trade-pilot/state?mode=` | `GET /state` |
| `GET  /api/client-area/trade-pilot/credits?mode=` | `GET /credits` |
| `POST /api/client-area/trade-pilot/analyses` | `POST /analyses` (BFF membuat `Idempotency-Key`, atau meneruskan dari header klien) |
| `GET  /api/client-area/trade-pilot/analyses/[id]` | `GET /analyses/{id}` (cek `analysis.mode` terhadap akun user) |
| `GET  /api/client-area/trade-pilot/history?mode=&cursor=` | `GET /history` |
| `GET  /api/client-area/trade-pilot/performance?mode=&instrumentId=` | `GET /performance` |
| `GET  /api/client-area/trade-pilot/indicators?instrumentId=&timeframe=` | `GET /indicators` |
| `GET  /api/client-area/trade-pilot/candles?instrumentId=&timeframe=` | `GET /candles` |
| `GET/POST /api/client-area/trade-pilot/alerts` | `GET/POST /alerts` |
| `DELETE /api/client-area/trade-pilot/alerts/[id]` | `DELETE /alerts/{id}` |
| `POST /api/internal/trade-pilot/alerts` | ← webhook dari backend (§9.3) |

### 10.3 cURL

```bash
BASE=http://localhost:5000/v1/trade-pilot
H=(-H "X-Api-Key: $TRADE_PILOT_API_KEY" -H "X-User-Id: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" -H "X-Allowed-Modes: demo,real")

curl -s "$BASE/state?mode=demo" "${H[@]}"
curl -s "$BASE/credits?mode=demo" "${H[@]}"
curl -s -X POST "$BASE/analyses" "${H[@]}" -H "Content-Type: application/json" \
     -H "Idempotency-Key: analysis-$(date +%s)" -d '{"instrumentId":"gold","mode":"demo","timeframe":"60"}'
curl -s "$BASE/analyses/a_xxx" "${H[@]}"
curl -s "$BASE/history?mode=demo&limit=12" "${H[@]}"
curl -s "$BASE/performance?mode=demo&instrumentId=gold" "${H[@]}"
curl -s "$BASE/indicators?instrumentId=gold&timeframe=60" "${H[@]}"
curl -s "$BASE/candles?instrumentId=gold&timeframe=60" "${H[@]}"
curl -s "$BASE/alerts?mode=demo" "${H[@]}"
curl -s -X POST "$BASE/alerts" "${H[@]}" -H "Content-Type: application/json" \
     -d '{"analysisId":"a_xxx","mode":"demo","side":"buy","levels":["entry","stopLoss","takeProfitOne"],"channels":["push"]}'
curl -s -X DELETE "$BASE/alerts/al_xxx" "${H[@]}" -i
```

### 10.4 PowerShell

```powershell
$base = "http://localhost:5000/v1/trade-pilot"
$headers = @{
  "X-Api-Key"       = $env:TRADE_PILOT_API_KEY
  "X-User-Id"       = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  "X-Allowed-Modes" = "demo,real"
}

Invoke-RestMethod "$base/state?mode=demo" -Headers $headers

$body = @{ instrumentId = "gold"; mode = "demo"; timeframe = "60" } | ConvertTo-Json
Invoke-RestMethod "$base/analyses" -Method Post -ContentType "application/json" -Body $body `
  -Headers ($headers + @{ "Idempotency-Key" = "analysis-$([guid]::NewGuid())" })
```

### 10.5 Postman / Bruno / Insomnia

1. Body `POST` harus **raw JSON** (bukan form-data / text).
2. `timeframe` diisi string (`"60"`).
3. Header: `X-Api-Key`, `X-User-Id`, `X-Allowed-Modes`, `Content-Type`,
   `Accept-Language`, plus `Idempotency-Key` untuk `POST /analyses`.
4. API key salah selalu `401`; API key benar tapi header/body lain salah → `400`.

---

## 11. Siklus hidup sinyal & background job

### 11.1 Siklus status

```text
                       ┌──── SL tersentuh ─────────────▶ stop_loss
POST /analyses ─▶ still_valid ── TP2 tersentuh ───────▶ take_profit_2
                       │  └─ TP1 tersentuh (dicatat) ──┐
                       └──── lewat validUntil ─────────┴▶ take_profit_1 (jika TP1 pernah tersentuh)
                                                         expired       (jika tidak)
```

Aturan evaluasi:

1. Level dianggap tersentuh jika berada **di antara** harga evaluasi sebelumnya
   dan harga live terbaru (bukan hanya sama persis).
2. Sebelum ada sisi aktif, evaluator menunggu **Entry buy atau sell** tersentuh.
   Jika keduanya terlewati di menit yang sama, dipilih entry yang paling dekat
   ke harga sebelumnya.
3. Setelah sisi aktif, SL dan TP2 bersifat final (jika keduanya terlewati
   bersamaan, yang lebih dekat ke harga sebelumnya menang). TP1 hanya dicatat.
4. Jika entry tidak pernah tersentuh sampai `validUntil` → `expired`.
5. Jika harga live tidak tersedia, sinyal tetap menunggu; saat lewat
   `validUntil` langsung diputus `take_profit_1`/`expired`.
6. Saat status final, semua alert analisis tersebut dinonaktifkan.

### 11.2 Background job (berjalan di dalam proses API)

| Job | Interval | Delay awal | Tugas |
|---|---|---|---|
| `evaluateTradePilotSignals` | 1 menit | 8 detik | Evaluasi entry/SL/TP/expiry & memicu alert/webhook |
| `aggregateTradePilotPerformance` | 15 menit | 16 detik | Hitung ulang `tp_performance_snapshot` (per mode × instrumen/`*` × timeframe) |
| `maintainTradePilotCreditsAndIdempotency` | 1 jam | 24 detik | Reset kredit yang periodenya lewat & hapus idempotency > 24 jam |

### 11.3 Catatan perilaku lain

1. **Kredit dibuat otomatis** saat user pertama kali memanggil `/state`,
   `/credits`, atau `/analyses`. Tidak ada endpoint registrasi.
2. **Reset kredit** terjadi saat request (lazy) dan juga oleh job tiap 1 jam.
   Jika env allowance diubah, nilai baru berlaku pada periode berikutnya.
3. **Kredit hanya dipotong jika analisis berhasil disimpan.** Kegagalan feed/AI
   (`503`) tidak mengurangi kredit.
4. **Evaluator sinyal** berjalan tiap 1 menit: level dianggap tersentuh jika
   berada di antara harga evaluasi sebelumnya dan harga terbaru. Jika entry buy
   dan sell sama-sama terlewati, dipilih entry terdekat dari harga sebelumnya.
   SL dan TP2 bersifat final; TP1 dicatat, lalu menjadi `take_profit_1` saat expiry.
5. **Mode `real`** memakai tier biaya OpenAI berbayar; `demo` memakai tier gratis.
6. **Kepemilikan data** selalu dibatasi `X-User-Id`. ID milik user lain → `404`.
7. **Endpoint tanpa cek `X-Allowed-Modes`:** `GET /analyses/{id}`,
   `DELETE /alerts/{id}`, `/indicators`, `/candles`. Batasi di BFF bila perlu.
8. **Path tidak dikenal** di bawah `/v1/trade-pilot` mengembalikan JSON
   `404 not_found` (bukan HTML). Jika menerima HTML, base URL BFF salah.
9. **Single instance:** job evaluator berjalan di dalam proses API. Pada
   deployment multi-replica, aktifkan scheduler di satu instance saja agar
   webhook tidak terkirim ganda.

---

## 12. Konfigurasi environment

### 12.1 Backend SGB-TP

| Variabel | Wajib | Default | Keterangan |
|---|---|---|---|
| `TRADE_PILOT_API_KEY` | **Ya** | – | Secret server-to-server. Kosong → semua request `401` |
| `TRADE_PILOT_DEMO_ALLOWANCE` | Tidak | `5` | Kredit demo per periode (bilangan bulat > 0) |
| `TRADE_PILOT_REAL_ALLOWANCE` | Tidak | `50` | Kredit real per periode |
| `TRADE_PILOT_DEMO_CREDIT_PERIOD` | Tidak | `daily` | `daily` \| `weekly` \| `monthly` (UTC). Nilai lain → default |
| `TRADE_PILOT_REAL_CREDIT_PERIOD` | Tidak | `monthly` | idem |
| `TRADE_PILOT_ALERT_WEBHOOK_URL` | Tidak | – | URL receiver di BFF. Kosong → alert tetap tercatat, tanpa callback |
| `TRADE_PILOT_ALERT_WEBHOOK_API_KEY` | Tidak | – | Dikirim sebagai `X-Api-Key` pada webhook. Gunakan secret **berbeda** dari API key inbound |
| `OPENAI_API_KEY` | **Ya** untuk analisis | – | Tanpa key valid, `POST /analyses` → `503` |
| `DATABASE_URL` | **Ya** | – | Postgres |
| `PGSSLMODE` | Tidak | TLS ketat | `disable` hanya untuk Postgres lokal di jaringan Docker privat |
| `PUBLIC_BASE_URL` | Ya | – | Origin publik aplikasi (CORS & OAuth) |
| `PORT` | Tidak | `5000` (Docker) | |
| `TZ` | Tidak | `Asia/Jakarta` | Zona waktu container (periode kredit tetap dihitung UTC) |

Perubahan allowance berlaku pada **periode berikutnya** untuk saldo yang sudah
ada. Restart container setelah mengubah env.

### 12.2 BFF get-sgb (server-only, jangan pakai prefix `NEXT_PUBLIC_`)

```env
TRADE_PILOT_API_URL=http://localhost:5000/v1/trade-pilot
TRADE_PILOT_API_KEY=<sama dengan backend>
CLIENT_AREA_SESSION_SECRET=<secret pembentuk X-User-Id>
TRADE_PILOT_ALERT_WEBHOOK_API_KEY=<sama dengan backend, untuk verifikasi webhook>
```

Hostname `TRADE_PILOT_API_URL` per topologi:

| get-sgb berjalan di | Backend berjalan di | Host |
|---|---|---|
| Host | Host / Docker port-mapped | `localhost:5000` |
| Docker | Host | `host.docker.internal:5000` |
| Docker (network sama) | Docker | `<nama-service>:5000` |
| Produksi | Produksi | `https://<domain-backend>` |

---

## 13. Database

Migrasi: `lib/db/migrations/0001_trade_pilot_v1.sql` — idempoten
(`IF NOT EXISTS`) dan **tidak dijalankan otomatis**; terapkan manual ke
database yang dituju (lihat §2 langkah 2).

### 13.1 `tp_credit_balance` — PK `(user_id, mode)`
| Kolom | Tipe | Keterangan |
|---|---|---|
| `user_id` | text | ID opaque |
| `mode` | text | `demo` \| `real` |
| `allowance` | int ≥ 0 | Jatah periode |
| `consumed` | int ≥ 0 | Terpakai |
| `period_start` | timestamptz | Awal periode |
| `resets_at` | timestamptz | Akhir periode (indexed) |
| `updated_at` | timestamptz | |

### 13.2 `tp_analysis` — PK `id`
| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | text | `a_...` |
| `user_id`, `mode` | text | Pemilik & namespace |
| `instrument_id`, `instrument_label` | text | |
| `timeframe`, `timeframe_label` | text | |
| `direction`, `market_sentiment` | text | |
| `price_at_analysis` | numeric(24,8) | |
| `buy_levels`, `sell_levels` | jsonb | `{entry, stopLoss, takeProfitOne, takeProfitTwo}` |
| `indicators` | jsonb | Array `IndicatorItem` |
| `status` | text | Default `still_valid` (indexed) |
| `active_side` | text | `buy`/`sell` setelah entry tersentuh |
| `take_profit_one_hit_at` | timestamptz | |
| `last_evaluated_price` | numeric(24,8) | Harga evaluasi terakhir |
| `analyzed_at`, `valid_until`, `resolved_at` | timestamptz | |

Index: `(user_id, mode, analyzed_at DESC)`, `(status)`.

### 13.3 `tp_idempotency` — PK `(user_id, key)`
| Kolom | Tipe | Keterangan |
|---|---|---|
| `request_hash` | text | SHA-256 dari `{mode, instrumentId, timeframe}` |
| `analysis_id` | text | FK → `tp_analysis.id` (cascade) |
| `response` | jsonb | Snapshot response 201 |
| `created_at` | timestamptz | Dihapus setelah 24 jam |

### 13.4 `tp_price_alert` — PK `id`, UNIQUE `(analysis_id, side)`
| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | text | `al_...` |
| `user_id`, `mode` | text | |
| `analysis_id` | text | FK → `tp_analysis.id` (cascade) |
| `side` | text | `buy` \| `sell` |
| `levels`, `channels` | jsonb | |
| `active` | boolean | (indexed) |
| `last_triggered_level` | text | |
| `created_at` | timestamptz | |

### 13.5 `tp_performance_snapshot` — PK `(mode, instrument_id, timeframe)`
Kolom: `sample`, `still_valid`, `expired`, `stop_loss`, `tp1`, `tp2`,
`win_rate`, `completion`, `minimum_samples`, `updated_at`. `instrument_id = '*'`
berarti agregat semua instrumen. Seluruh isi tabel diganti setiap 15 menit.

### 13.6 Query bantu operasional

```sql
-- Sisa kredit user
SELECT mode, allowance, consumed, allowance - consumed AS remaining, resets_at
FROM tp_credit_balance WHERE user_id = '<opaque-id>';

-- Sinyal aktif
SELECT id, instrument_label, timeframe_label, active_side, valid_until
FROM tp_analysis WHERE status = 'still_valid' ORDER BY analyzed_at DESC;

-- Tambah 1 kredit manual (kompensasi)
UPDATE tp_credit_balance SET consumed = GREATEST(consumed - 1, 0), updated_at = now()
WHERE user_id = '<opaque-id>' AND mode = 'demo';
```

---

## 14. Deployment: Docker & Replit

### 14.1 Docker

- **Image:** multi-stage `node:24-bookworm-slim`, pnpm 10, berjalan sebagai user
  non-root `node`, port `5000`, healthcheck ke `/api/healthz` tiap 30 detik.
  Satu container melayani web app TradePilot **dan** API (termasuk `/v1/trade-pilot`).
- **Compose (`compose.yaml`):** service `app` + `db` (`postgres:16-alpine`) dengan
  volume `postgres-data`; container app `read_only`, `cap_drop: ALL`,
  `no-new-privileges`, `/tmp` tmpfs 64 MB.

```powershell
copy .env.docker.example .env
docker compose up -d --build
docker compose ps
docker compose logs --tail 100 app
```

Variabel `.env` Docker: `APP_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`,
`POSTGRES_DB`, `PUBLIC_BASE_URL`, `TZ`, `PGSSLMODE`, `OPENAI_API_KEY`, seluruh
`TRADE_PILOT_*`, serta integrasi opsional (OAuth, Firebase, DOKU, VAPID).

### 14.2 Replit

- Simpan `TRADE_PILOT_API_KEY`, `TRADE_PILOT_ALERT_WEBHOOK_API_KEY`, dan
  `OPENAI_API_KEY` di **Replit Secrets** — jangan di `.replit`, `replit.md`,
  atau `.env.example`.
- Terapkan migrasi `0001_trade_pilot_v1.sql` ke database produksi secara
  manual sebelum get-sgb diarahkan ke sana.
- Deployment satu instance; jika diskalakan, lihat batasan scheduler (§18).

---

## 15. Testing

```bash
pnpm --filter @workspace/api-server test
```

| File | Cakupan |
|---|---|
| `artifacts/api-server/src/routes/__tests__/trade-pilot.test.ts` | API key ditolak dengan format error standar, `X-User-Id` non-opaque ditolak sebelum menyentuh DB, lokalisasi error via `Accept-Language`, validasi parameter candle |
| `artifacts/api-server/src/lib/__tests__/trade-pilot-candles.test.ts` | Bentuk respons candle, metadata stale, fallback monthly → weekly |
| `artifacts/ai-trading/src/components/__tests__/analysis-levels-chart.test.tsx` | Render chart dari respons v1 melalui `candlesUrl` + `tradePilotAnalysis` |

Uji manual minimal sebelum go-live:

- [ ] `401` dengan key salah, `400` dengan `X-User-Id` salah.
- [ ] `POST /analyses` sukses, kredit berkurang 1.
- [ ] Ulangi dengan `Idempotency-Key` sama → response identik, kredit tetap.
- [ ] Key sama + body beda → `409`.
- [ ] Habiskan kredit demo → `402`.
- [ ] `X-Allowed-Modes: demo` + `mode=real` → `403`.
- [ ] Chart tampil via proxy BFF; garis level sesuai analisis.
- [ ] Alert dipasang, webhook diterima BFF (pakai timeframe `1` untuk uji cepat).

---

## 16. Keamanan

- API key **hanya di server BFF**; jangan pernah di bundle browser, query
  string, atau log. Rotasi key yang pernah tertempel di chat/tiket/screenshot.
- Gunakan **HTTPS** untuk backend dan webhook di produksi.
- Gunakan secret **berbeda** untuk API inbound dan webhook outbound.
- Bentuk `X-Allowed-Modes` dari data akun yang terverifikasi, bukan dari browser.
- Untuk endpoint yang tidak mengecek mode (`/analyses/{id}`, `DELETE /alerts/{id}`),
  validasi kepemilikan mode di BFF.
- Batasi akses jaringan ke `/v1/trade-pilot` hanya dari BFF (IP allowlist /
  private network) jika infrastruktur mendukung.
- Terapkan rate limit per user di BFF — backend v1 tidak punya rate limiter
  sendiri selain batas kredit.
- Jangan mencatat email mentah atau `X-Api-Key`; cukup ID opaque.
- Backend memakai perbandingan *timing-safe* untuk API key; receiver webhook
  sebaiknya melakukan hal yang sama (contoh §9.3).

---

## 17. Troubleshooting

| Gejala | Penyebab yang paling mungkin | Solusi |
|---|---|---|
| `400 invalid_request` di `POST /analyses` | Body bukan JSON / `timeframe` angka / `Idempotency-Key` mengandung `_` atau < 8 karakter / `X-User-Id` bukan 64 hex | Periksa satu per satu sesuai §3 dan §7.3 |
| `401 unauthorized` | `TRADE_PILOT_API_KEY` backend kosong, header bukan `X-Api-Key`, key BFF ≠ backend, container belum restart | Samakan key, restart container |
| `402 insufficient_credit` | Kredit periode habis | Cek `GET /credits` → `resetsAt`; naikkan allowance jika perlu |
| `403 access_denied` | `mode` tidak ada di `X-Allowed-Modes` | Periksa logika cek akun di BFF |
| `404 not_found` di analisis/alert | ID milik `X-User-Id` lain (mis. secret HMAC berubah) | Pastikan secret pembentuk ID stabil |
| `409 idempotency_conflict` | Key dipakai ulang untuk payload berbeda | Key baru per aksi Analisa |
| `503 analysis_unavailable` | `OPENAI_API_KEY` tidak valid, feed harga/candle tidak terjangkau, AI tidak mengembalikan level lengkap | Cek key, koneksi keluar, `docker compose logs app`; coba lagi dengan key sama |
| `POST /alerts` → `404` | `analysisId` ada tapi `mode` berbeda | Kirim `mode` yang sama dengan analisis |
| Response berupa HTML | URL tanpa `/v1/trade-pilot` (kena web app) | Perbaiki `TRADE_PILOT_API_URL` |
| `ECONNREFUSED` dari BFF di Docker | `localhost` menunjuk container BFF sendiri | Pakai `host.docker.internal` / nama service |
| Chart error "[object Object]" | Proxy meneruskan error v1 (objek) ke komponen yang mengharapkan string | Ratakan error di proxy (§8.2) |
| Chart `1M` terlihat mingguan | Belum ada feed candle bulanan | Normal — gunakan label `candleTimeframe` |
| Webhook tidak masuk | URL kosong, receiver > 5 detik, key tidak cocok | Isi URL, balas cepat, samakan key; cek log `Trade Pilot alert webhook failed` |
| Webhook dobel | Lebih dari satu instance menjalankan scheduler | Satu instance scheduler; receiver idempoten |
| Performa selalu `null` | Belum ada ≥ 10 analisis selesai per timeframe | Normal; tampilkan `minimumSamples` |

---

## 18. Batasan versi saat ini

- `OPENAI_API_KEY` wajib untuk analisis live.
- Hanya 4 instrumen (`gold`, `brent`, `hang-seng`, `nikkei`).
- Timeframe `M` memakai candle mingguan (belum ada feed bulanan).
- Maksimal 300 candle per request, tanpa paginasi.
- Status `invalid` dan refund kredit otomatis belum ada alurnya.
- Statistik performa bersifat global per mode, bukan per user.
- Push alert hanya via webhook ke BFF; tidak memakai FCM/Web Push milik
  aplikasi TradePilot.id karena v1 hanya mengenal ID opaque.
- Webhook tanpa retry; scheduler berjalan di proses API (perlu single-worker
  untuk deployment multi-replica).
- Tidak ada rate limiter khusus di v1 selain kuota kredit.
- Route BFF `/api/client-area/trade-pilot/*` berada di repository get-sgb,
  bukan di repository ini.

---

## 19. Checklist integrasi get-sgb

**Konfigurasi**
- [ ] `TRADE_PILOT_API_URL`, `TRADE_PILOT_API_KEY`, `CLIENT_AREA_SESSION_SECRET` diset sebagai env server-only.
- [ ] Migrasi `0001_trade_pilot_v1.sql` sudah diterapkan di database target.
- [ ] `OPENAI_API_KEY` valid di backend.

**Identitas & akses**
- [ ] `X-User-Id` dibentuk dengan HMAC-SHA256 stabil (64 hex).
- [ ] Pemetaan `tradePilotUserId → user` disimpan (untuk webhook).
- [ ] Session & akun demo/real divalidasi sebelum setiap request.
- [ ] `X-Allowed-Modes` selalu dikirim.
- [ ] Kepemilikan mode dicek di BFF untuk `/analyses/{id}` dan `DELETE /alerts/{id}`.

**Analisis**
- [ ] `Idempotency-Key` baru per klik, dipertahankan saat retry.
- [ ] Timeout 30 detik untuk analisis, 10 detik untuk read.
- [ ] Semua error code ditangani dengan pesan UI (§5.1).

**Chart**
- [ ] Proxy `/api/client-area/trade-pilot/candles` dengan error diratakan jadi string.
- [ ] Garis Entry/SL/TP dari `buyLevels`/`sellLevels`, sisi awal dari `direction`.
- [ ] Badge `isStale` dan label `candleTimeframe`.

**Alert**
- [ ] Receiver webhook terverifikasi `X-Api-Key`, membalas < 5 detik, idempoten.
- [ ] UI memperlihatkan `active` & `lastTriggeredLevel` dari `GET /alerts`.

**Keamanan & operasional**
- [ ] API key tidak muncul di browser/network tab/log.
- [ ] HTTPS di produksi; akses `/v1/trade-pilot` dibatasi ke BFF.
- [ ] Rate limit per user di BFF.
- [ ] Demo dan real diuji sebagai namespace terpisah.

---

## 20. Lampiran: peta file kode

| File | Isi |
|---|---|
| `artifacts/api-server/src/app.ts` | Mount `app.use("/v1/trade-pilot", tradePilotRouter)` (sebelum `/api`) |
| `artifacts/api-server/src/routes/trade-pilot.ts` | Middleware API key/`X-User-Id`, validasi Zod, 11 endpoint |
| `artifacts/api-server/src/lib/trade-pilot.ts` | Pemetaan instrumen/timeframe, kredit, analisis, idempotency, alert, evaluator, agregasi |
| `artifacts/api-server/src/locales/trade-pilot.ts` | Pesan error ID/EN |
| `artifacts/api-server/src/lib/jobs.ts` | Penjadwalan 3 job Trade Pilot |
| `artifacts/api-server/src/lib/historical.ts` | Sumber candle & snapshot stale |
| `artifacts/api-server/src/lib/indicators.ts` | Perhitungan RSI, MACD, Stochastic, Bollinger, SMA/EMA |
| `artifacts/api-server/src/lib/openai.ts` | Mesin analisis AI (tier biaya `free`/`paid`) |
| `lib/db/src/schema/index.ts` | Definisi Drizzle tabel `tp_*` |
| `lib/db/migrations/0001_trade_pilot_v1.sql` | Migrasi SQL |
| `artifacts/ai-trading/src/components/analysis-levels-chart.tsx` | Komponen chart + `tradePilotV1AnalysisToTradePlan()` |
| `docs/TRADE_PILOT_V1_OPENAPI.yaml` | Kontrak OpenAPI |
| `Dockerfile`, `compose.yaml`, `.env.docker.example` | Deployment |
