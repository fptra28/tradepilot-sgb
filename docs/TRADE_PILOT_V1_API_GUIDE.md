# Trade Pilot v1 API — Panduan Integrasi Lengkap

> ⚠️ **Kontrak berubah per 27 Oktober 2026.** Endpoint, header, dan payload
> sekarang mengikuti dokumen *Requirement API — TradePilot*. Sumber kebenaran
> terbaru: [`TRADE_PILOT_V1_API_REFERENCE.md`](./TRADE_PILOT_V1_API_REFERENCE.md)
> dan [`TRADE_PILOT_V1_OPENAPI.yaml`](./TRADE_PILOT_V1_OPENAPI.yaml). Bagian
> dokumen ini yang menyebut `X-Api-Key`, `X-User-Id`, `/state`, `/history`,
> `/performance`, `/alerts`, atau `analysis_unavailable` sudah tidak berlaku.


Dokumen ini menjelaskan kontrak server-to-server Trade Pilot v1 yang tersedia
di project `SGB-TP`. Target integrasinya adalah BFF Next.js milik `get-sgb`.
Browser tidak boleh memanggil API ini secara langsung.

Kontrak machine-readable tersedia di
[`TRADE_PILOT_V1_OPENAPI.yaml`](./TRADE_PILOT_V1_OPENAPI.yaml), sedangkan
ringkasan konfigurasi tersedia di
[`TRADE_PILOT_V1_CONFIGURATION.md`](./TRADE_PILOT_V1_CONFIGURATION.md).
Dokumentasi lengkap (semua topik dalam satu file) tersedia di
[`TRADE_PILOT_V1_FULL_DOCUMENTATION.md`](./TRADE_PILOT_V1_FULL_DOCUMENTATION.md).
Referensi payload per endpoint (request, response, dan error) tersedia di
[`TRADE_PILOT_V1_API_REFERENCE.md`](./TRADE_PILOT_V1_API_REFERENCE.md).

## 1. Ringkasan

Base URL lokal:

```text
http://localhost:5000/v1/trade-pilot
```

Endpoint yang tersedia:

| Method | Path | Kegunaan |
| --- | --- | --- |
| `GET` | `/state?mode=` | Bootstrap kredit, analisis terbaru, riwayat, dan performa |
| `GET` | `/credits?mode=` | Membaca saldo kredit terkini |
| `POST` | `/analyses` | Menjalankan analisis dan memotong satu kredit |
| `GET` | `/analyses/{id}` | Membuka detail dan status analisis |
| `GET` | `/history?mode=&limit=&cursor=` | Membaca riwayat dengan cursor pagination |
| `GET` | `/performance?mode=&instrumentId=` | Membaca performa per timeframe |
| `GET` | `/indicators?instrumentId=&timeframe=` | Mengambil indikator tanpa memotong kredit |
| `GET` | `/candles?instrumentId=&timeframe=` | Mengambil OHLC candle untuk chart Entry/SL/TP |
| `GET` | `/alerts?mode=` | Membaca alert milik user |
| `POST` | `/alerts` | Membuat atau memperbarui alert |
| `DELETE` | `/alerts/{id}` | Menghapus alert |

## 2. Arsitektur akun

Trade Pilot v1 tidak memiliki endpoint registrasi dan tidak menyimpan email,
password, atau nomor akun trading.

```text
Browser
  → login pada get-sgb
  → BFF get-sgb memvalidasi session dan kepemilikan akun demo/real
  → BFF membuat opaque X-User-Id
  → BFF memanggil /v1/trade-pilot dengan X-Api-Key
  → backend menyimpan kredit, analisis, history, dan alert berdasarkan opaque ID
```

Saldo Trade Pilot dibuat otomatis ketika opaque user pertama kali mengakses
`/state`, `/credits`, atau `/analyses`. Tidak ada `POST /users` khusus Trade
Pilot.

Endpoint lama `POST /api/auth/register` adalah autentikasi aplikasi mandiri
SGB-TP dan bukan bagian dari integrasi BFF v1.

## 3. Autentikasi dan header

Semua endpoint wajib menerima:

```http
X-Api-Key: <TRADE_PILOT_API_KEY>
X-User-Id: <64 karakter hexadecimal>
```

Header tambahan yang direkomendasikan:

```http
X-Allowed-Modes: demo,real
Accept-Language: id
```

`X-Allowed-Modes` bersifat opsional pada backend. Jika diberikan, request akan
ditolak dengan `403 access_denied` ketika parameter `mode` tidak tercantum.
BFF sebaiknya selalu mengirimkannya setelah memeriksa akun trading user.

`Accept-Language` yang diawali `en` menghasilkan pesan error bahasa Inggris.
Nilai lain menggunakan bahasa Indonesia.

### Membentuk X-User-Id

Gunakan HMAC-SHA256 yang stabil dan simpan secret hanya di server:

```ts
import { createHmac } from "node:crypto";

export function tradePilotUserId(email: string): string {
  return createHmac("sha256", process.env.CLIENT_AREA_SESSION_SECRET!)
    .update(`trade-pilot:${email.trim().toLowerCase()}`)
    .digest("hex");
}
```

Hasilnya harus tepat 64 karakter hex. Email tidak dikirim ke SGB-TP.

### Header idempotency

`POST /analyses` juga wajib menerima:

```http
Idempotency-Key: analysis-550e8400-e29b
```

Aturan key:

- Panjang 8–80 karakter.
- Hanya huruf, angka, dan tanda minus.
- Berlaku selama 24 jam per `X-User-Id`.
- Key dan payload yang sama mengembalikan snapshot response yang sama.
- Key sama dengan payload berbeda menghasilkan `409 idempotency_conflict`.
- Key dapat digunakan kembali setelah 24 jam.

## 4. Enum dan pemetaan

### Mode akun

| Nilai | Arti | Default lokal |
| --- | --- | --- |
| `demo` | Akun trading demo | 5 kredit per hari UTC |
| `real` | Akun trading real | 50 kredit per bulan UTC |

Mode ini berbeda dari mode presentasi lama `beginner/pro`. Engine internal v1
menggunakan keluaran pro, sedangkan pemisahan data dan kredit menggunakan
`demo/real`.

### Instrumen

| `instrumentId` | Label response | Instrumen engine |
| --- | --- | --- |
| `gold` | `XAU/USD` | `XAU/USD` |
| `brent` | `BCO` | `BRENT` |
| `hang-seng` | `HKK` | `HSI` |
| `nikkei` | `JPK` | `NIKKEI` |

### Timeframe

| Request | Label response | Konteks engine | Masa berlaku |
| --- | --- | --- | --- |
| `1` | `1m` | `1m` | 4 menit |
| `5` | `5m` | `5m` | 20 menit |
| `15` | `15m` | `15m` | 1 jam |
| `60` | `1h` | `1h` | 4 jam |
| `240` | `4h` | `4h` | 16 jam |
| `D` | `1D` | `1D` | 4 hari |
| `W` | `1W` | `1W` | 28 hari |
| `M` | `1M` | `1W` | 120 hari |

Engine market-data belum memiliki candle bulanan. Request `M` menggunakan
konteks candle mingguan tetapi tetap memiliki masa berlaku empat bulan.

### Status sinyal

| Status | Final | Keterangan |
| --- | --- | --- |
| `still_valid` | Tidak | Masih dipantau evaluator |
| `take_profit_1` | Ya | TP1 tersentuh, lalu masa berlaku berakhir |
| `take_profit_2` | Ya | TP2 tersentuh |
| `stop_loss` | Ya | Stop loss tersentuh |
| `expired` | Ya | Berakhir tanpa entry/TP1 yang valid |
| `invalid` | Ya | Dicadangkan untuk pembatalan/data bermasalah |

Status `invalid` sudah ada pada kontrak dan agregasi, tetapi versi sekarang
belum menyediakan endpoint admin untuk menetapkannya atau refund otomatis.

## 5. Format umum

- Request dan response menggunakan JSON.
- Timestamp menggunakan ISO 8601 UTC.
- Harga dikirim sebagai string desimal.
- Browser tidak boleh menerima `TRADE_PILOT_API_KEY`.
- Jangan menggunakan `NEXT_PUBLIC_` untuk konfigurasi Trade Pilot.

Format error:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Parameter permintaan tidak valid"
  }
}
```

| HTTP | Code | Penyebab umum |
| --- | --- | --- |
| `400` | `invalid_request` | Header user, body, query, mode, atau enum tidak valid |
| `401` | `unauthorized` | API key hilang/salah atau backend belum dikonfigurasi |
| `402` | `insufficient_credit` | Kredit mode tersebut habis |
| `403` | `access_denied` | Mode tidak tercantum pada `X-Allowed-Modes` |
| `404` | `not_found` | Analysis/alert bukan milik user atau route tidak ada |
| `409` | `idempotency_conflict` | Key sama digunakan untuk payload berbeda |
| `500` | `internal_error` | Gangguan internal yang tidak terduga |
| `503` | `analysis_unavailable` | AI, live price, candle, atau indikator tidak tersedia |

## 6. Endpoint detail

### GET /state

Mengambil data awal halaman. Pemanggilan pertama juga membuat saldo mode jika
belum tersedia.

```http
GET /v1/trade-pilot/state?mode=demo
```

Response `200`:

```json
{
  "mode": "demo",
  "credit": {
    "mode": "demo",
    "allowance": 5,
    "consumed": 0,
    "remaining": 5,
    "resetsAt": "2026-10-28T00:00:00.000Z"
  },
  "latestAnalysis": null,
  "history": [],
  "timeframePerformance": [
    {
      "timeframe": "1m",
      "sample": 0,
      "stillValid": 0,
      "expired": 0,
      "stopLoss": 0,
      "takeProfitOne": 0,
      "takeProfitTwo": 0,
      "winRate": null,
      "completion": null,
      "minimumSamples": 10
    }
  ]
}
```

`history` maksimal berisi 12 item terbaru. `timeframePerformance` selalu
memiliki delapan timeframe, termasuk ketika belum ada sampel.

### GET /credits

```http
GET /v1/trade-pilot/credits?mode=real
```

Response `200`:

```json
{
  "mode": "real",
  "allowance": 50,
  "consumed": 3,
  "remaining": 47,
  "resetsAt": "2026-11-01T00:00:00.000Z"
}
```

Reset dilakukan secara lazy saat saldo dibaca serta oleh job maintenance
setiap jam. Periode dihitung dalam UTC.

### POST /analyses

Menjalankan engine AI dan memotong satu kredit hanya setelah analisis berhasil.

```http
POST /v1/trade-pilot/analyses
Content-Type: application/json
Idempotency-Key: analysis-550e8400-e29b
```

Body:

```json
{
  "instrumentId": "gold",
  "mode": "demo",
  "timeframe": "60"
}
```

`timeframe` harus berupa string. Angka JSON `60` akan ditolak.

Response `201`:

```json
{
  "analysis": {
    "id": "a_mh8js9e12ab34cd56ef",
    "instrumentId": "gold",
    "instrumentLabel": "XAU/USD",
    "mode": "demo",
    "timeframe": "60",
    "timeframeLabel": "1h",
    "analyzedAt": "2026-10-27T03:00:00.000Z",
    "validUntil": "2026-10-27T07:00:00.000Z",
    "priceAtAnalysis": "4162.35000000",
    "direction": "bullish",
    "marketSentiment": "bullish",
    "buyLevels": {
      "entry": "4172.00",
      "stopLoss": "4152.00",
      "takeProfitOne": "4192.00",
      "takeProfitTwo": "4212.00"
    },
    "sellLevels": {
      "entry": "4148.00",
      "stopLoss": "4168.00",
      "takeProfitOne": "4128.00",
      "takeProfitTwo": "4108.00"
    },
    "indicators": [],
    "status": "still_valid",
    "resolvedAt": null
  },
  "credit": {
    "mode": "demo",
    "allowance": 5,
    "consumed": 1,
    "remaining": 4,
    "resetsAt": "2026-10-28T00:00:00.000Z"
  },
  "history": {
    "id": "a_mh8js9e12ab34cd56ef",
    "createdAt": "2026-10-27T03:00:00.000Z",
    "instrumentLabel": "XAU/USD",
    "mode": "demo",
    "timeframeLabel": "1h",
    "status": "still_valid",
    "resolvedAt": null
  }
}
```

Analisis dan pemotongan kredit disimpan dalam satu transaksi database. Kegagalan
AI tidak memotong kredit.

### GET /analyses/{id}

```http
GET /v1/trade-pilot/analyses/a_mh8js9e12ab34cd56ef
```

Response adalah object `analysis` langsung, bukan `{ "analysis": ... }`.
Ownership selalu dibatasi oleh `X-User-Id`; ID milik user lain menghasilkan
`404 not_found`.

### GET /history

```http
GET /v1/trade-pilot/history?mode=demo&limit=12
```

`limit` default 12, minimum 1, maksimum 50.

Response `200`:

```json
{
  "items": [
    {
      "id": "a_mh8js9e12ab34cd56ef",
      "createdAt": "2026-10-27T03:00:00.000Z",
      "instrumentLabel": "XAU/USD",
      "mode": "demo",
      "timeframeLabel": "1h",
      "status": "still_valid",
      "resolvedAt": null
    }
  ],
  "nextCursor": "WyIyMDI2LTEwLTI3VDAzOjAwOjAwLjAwMFoiLCJhX20uLi4iXQ"
}
```

Untuk halaman berikutnya, kirim `nextCursor` tanpa mengubahnya:

```http
GET /v1/trade-pilot/history?mode=demo&limit=12&cursor=<nextCursor>
```

`nextCursor: null` berarti tidak ada halaman berikutnya.

### GET /performance

Semua instrumen:

```http
GET /v1/trade-pilot/performance?mode=demo
```

Satu instrumen:

```http
GET /v1/trade-pilot/performance?mode=demo&instrumentId=gold
```

Response `200` berupa array delapan timeframe:

```json
[
  {
    "timeframe": "1h",
    "sample": 42,
    "stillValid": 1,
    "expired": 31,
    "stopLoss": 7,
    "takeProfitOne": 0,
    "takeProfitTwo": 3,
    "winRate": 7,
    "completion": 98,
    "minimumSamples": null
  }
]
```

`winRate` dan `completion` tetap `null` sampai terdapat minimal 10 hasil final.
Snapshot dihitung ulang setiap 15 menit.

### GET /indicators

```http
GET /v1/trade-pilot/indicators?instrumentId=gold&timeframe=60
```

Response `200`:

```json
{
  "instrumentId": "gold",
  "timeframe": "60",
  "calculatedAt": "2026-10-27T03:00:00.000Z",
  "items": [
    {
      "key": "rsi_14",
      "label": "RSI (14)",
      "group": "oscillator",
      "value": "44.87",
      "status": "buy",
      "marker": 45
    }
  ]
}
```

Endpoint ini tidak memotong kredit. Item dapat berisi RSI, MACD, Stochastic,
Bollinger, serta moving average yang tersedia dari engine.

### GET /candles

Mengambil maksimal 300 candle OHLC untuk menggambar chart beserta garis Entry,
SL, TP1, dan TP2. Endpoint ini tidak memotong kredit.

```http
GET /v1/trade-pilot/candles?instrumentId=gold&timeframe=60
```

Response `200`:

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
    {
      "date": "2026-10-27T02:00:00.000Z",
      "open": 4158.2,
      "high": 4165.1,
      "low": 4154.8,
      "close": 4162.35
    }
  ]
}
```

Untuk `timeframe=M`, analisis mempertahankan label `1M`, tetapi
`candleTimeframe` bernilai `1W` karena engine market-data belum menyediakan
candle bulanan. Frontend/BFF harus menggunakan `candleTimeframe` sebagai
granularitas candle yang sebenarnya.

API key tetap hanya boleh berada di BFF. Browser mengambil candle melalui
proxy BFF, misalnya `/api/client-area/trade-pilot/candles`, lalu memberikan URL
tersebut ke prop `candlesUrl` pada `AnalysisLevelsChart`. Prop
`tradePilotAnalysis` menerima langsung `direction`, `buyLevels`, dan
`sellLevels` dari respons analisis v1.

### GET /alerts

```http
GET /v1/trade-pilot/alerts?mode=demo
```

Response `200`:

```json
[
  {
    "id": "al_mh8js9e12ab34cd56ef",
    "analysisId": "a_mh8js9e12ab34cd56ef",
    "side": "buy",
    "levels": ["entry", "stopLoss", "takeProfitOne", "takeProfitTwo"],
    "channels": ["push"],
    "active": true,
    "lastTriggeredLevel": null,
    "createdAt": "2026-10-27T03:01:00.000Z"
  }
]
```

### POST /alerts

```http
POST /v1/trade-pilot/alerts
Content-Type: application/json
```

Body:

```json
{
  "analysisId": "a_mh8js9e12ab34cd56ef",
  "mode": "demo",
  "side": "buy",
  "levels": ["entry", "stopLoss", "takeProfitOne", "takeProfitTwo"],
  "channels": ["push"]
}
```

Satu analysis hanya mempunyai satu alert per side. Request berikutnya untuk
analysis dan side yang sama memperbarui serta mengaktifkan kembali alert lama.

Response `201`:

```json
{
  "id": "al_mh8js9e12ab34cd56ef",
  "analysisId": "a_mh8js9e12ab34cd56ef",
  "side": "buy",
  "levels": ["entry", "stopLoss", "takeProfitOne", "takeProfitTwo"],
  "channels": ["push"],
  "active": true,
  "createdAt": "2026-10-27T03:01:00.000Z"
}
```

### DELETE /alerts/{id}

```http
DELETE /v1/trade-pilot/alerts/al_mh8js9e12ab34cd56ef
```

Response sukses adalah `204 No Content`. Alert harus dimiliki oleh
`X-User-Id` yang memanggil.

## 7. Contoh request

### cURL

```bash
curl "http://localhost:5000/v1/trade-pilot/performance?mode=demo" \
  -H "X-Api-Key: $TRADE_PILOT_API_KEY" \
  -H "X-User-Id: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \
  -H "X-Allowed-Modes: demo,real"
```

```bash
curl -X POST "http://localhost:5000/v1/trade-pilot/analyses" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $TRADE_PILOT_API_KEY" \
  -H "X-User-Id: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \
  -H "X-Allowed-Modes: demo,real" \
  -H "Idempotency-Key: analysis-550e8400-e29b" \
  --data '{"instrumentId":"gold","mode":"demo","timeframe":"60"}'
```

### PowerShell

```powershell
$headers = @{
  "X-Api-Key" = $env:TRADE_PILOT_API_KEY
  "X-User-Id" = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  "X-Allowed-Modes" = "demo,real"
  "Idempotency-Key" = "analysis-550e8400-e29b"
}

$body = @{
  instrumentId = "gold"
  mode = "demo"
  timeframe = "60"
} | ConvertTo-Json

$request = @{
  Method = "Post"
  Uri = "http://localhost:5000/v1/trade-pilot/analyses"
  Headers = $headers
  ContentType = "application/json"
  Body = $body
}

Invoke-RestMethod @request
```

### Next.js BFF

```ts
import { randomUUID } from "node:crypto";

const baseUrl = process.env.TRADE_PILOT_API_URL!;

export async function runTradePilotAnalysis(input: {
  userId: string;
  allowedModes: Array<"demo" | "real">;
  instrumentId: "gold" | "brent" | "hang-seng" | "nikkei";
  mode: "demo" | "real";
  timeframe: "1" | "5" | "15" | "60" | "240" | "D" | "W" | "M";
}) {
  const response = await fetch(`${baseUrl}/analyses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": process.env.TRADE_PILOT_API_KEY!,
      "X-User-Id": input.userId,
      "X-Allowed-Modes": input.allowedModes.join(","),
      "Idempotency-Key": `analysis-${randomUUID()}`,
    },
    body: JSON.stringify({
      instrumentId: input.instrumentId,
      mode: input.mode,
      timeframe: input.timeframe,
    }),
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });

  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.code ?? "trade_pilot_error");
  return payload;
}
```

## 8. Konfigurasi environment

### Backend

```env
TRADE_PILOT_API_KEY=<secret server-to-server>
TRADE_PILOT_DEMO_ALLOWANCE=5
TRADE_PILOT_REAL_ALLOWANCE=50
TRADE_PILOT_DEMO_CREDIT_PERIOD=daily
TRADE_PILOT_REAL_CREDIT_PERIOD=monthly
TRADE_PILOT_ALERT_WEBHOOK_URL=
TRADE_PILOT_ALERT_WEBHOOK_API_KEY=
OPENAI_API_KEY=<required untuk POST /analyses>
```

Nilai periode yang didukung: `daily`, `weekly`, dan `monthly`. Nilai tidak
dikenal kembali ke default: demo harian dan real bulanan.

### get-sgb BFF

```env
TRADE_PILOT_API_URL=http://localhost:5000/v1/trade-pilot
TRADE_PILOT_API_KEY=<secret yang sama dengan backend>
CLIENT_AREA_SESSION_SECRET=<secret pembentuk opaque user id>
```

Backend tidak membaca `TRADE_PILOT_API_URL`; variable tersebut ditujukan untuk
BFF/client server-side.

## 9. Alert webhook

Jika `TRADE_PILOT_ALERT_WEBHOOK_URL` diisi, evaluator mengirim `POST` berikut
ketika level yang didaftarkan tersentuh:

```json
{
  "alertId": "al_mh8js9e12ab34cd56ef",
  "userId": "<opaque-user-id>",
  "analysisId": "a_mh8js9e12ab34cd56ef",
  "mode": "demo",
  "instrumentId": "gold",
  "side": "buy",
  "level": "takeProfitOne",
  "price": "4192.00",
  "channels": ["push"],
  "triggeredAt": "2026-10-27T05:12:00.000Z"
}
```

Header webhook:

```http
Content-Type: application/json
X-Api-Key: <TRADE_PILOT_ALERT_WEBHOOK_API_KEY>
```

Timeout pengiriman adalah 5 detik. Kegagalan webhook dicatat ke log dan tidak
membatalkan evaluasi status. Jika URL kosong, subscription tetap tersimpan,
tetapi callback eksternal tidak dikirim.

## 10. Background jobs

| Job | Interval | Delay awal | Tugas |
| --- | --- | --- | --- |
| Evaluator sinyal | 1 menit | 8 detik | Mengecek entry, TP, SL, expiry, dan alert |
| Agregasi performa | 15 menit | 16 detik | Mengganti snapshot performa per mode/instrumen/timeframe |
| Maintenance | 1 jam | 24 detik | Reset periode kredit dan hapus idempotency lebih dari 24 jam |

Evaluator menyimpan harga terakhir. Level dianggap tersentuh jika berada di
antara harga evaluasi sebelumnya dan harga terbaru. Jika buy dan sell entry
terlewati pada interval yang sama, sisi dengan entry terdekat dari harga
sebelumnya dipilih. Setelah status final, alert analysis dinonaktifkan.

Job berjalan di dalam proses API. Jika deployment menggunakan beberapa replica,
gunakan hanya satu scheduler aktif atau pindahkan job ke worker tunggal untuk
menghindari callback webhook ganda.

## 11. Database

Migrasi:

```text
lib/db/migrations/0001_trade_pilot_v1.sql
```

Tabel:

| Tabel | Isi |
| --- | --- |
| `tp_credit_balance` | Allowance, konsumsi, dan periode per opaque user/mode |
| `tp_analysis` | Hasil analisis, level, indikator, status, dan evaluasi harga |
| `tp_idempotency` | Hash request dan snapshot response selama 24 jam |
| `tp_price_alert` | Alert per analysis dan side |
| `tp_performance_snapshot` | Agregasi performa yang dibaca endpoint |

Menerapkan migrasi pada Docker lokal:

```powershell
Get-Content -Raw .\lib\db\migrations\0001_trade_pilot_v1.sql |
  docker compose exec -T db sh -lc 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Migrasi bersifat idempoten (`IF NOT EXISTS`), tetapi tetap harus diarahkan ke
environment database yang benar.

## 12. Docker

Build dan jalankan:

```powershell
docker compose up -d --build
```

Periksa status:

```powershell
docker compose ps
docker compose logs --tail 100 app
```

Health endpoint:

```text
GET http://localhost:5000/api/healthz
```

Response sehat:

```json
{ "status": "ok" }
```

Jika BFF berada di container lain, `localhost` menunjuk ke container BFF itu
sendiri. Gunakan nama service Docker pada network yang sama, atau
`host.docker.internal` ketika backend berjalan pada host.

## 13. Postman/Bruno/Insomnia

Untuk `POST /analyses`:

1. Method: `POST`.
2. URL: `http://localhost:5000/v1/trade-pilot/analyses`.
3. Body: pilih JSON, bukan form-data atau text.
4. Isi body dengan `instrumentId`, `mode`, dan string `timeframe`.
5. Isi enam header: `X-Api-Key`, `X-User-Id`, `X-Allowed-Modes`,
   `Idempotency-Key`, `Content-Type`, dan `Accept-Language`.

Jika API key diterima tetapi body/header lain salah, responsnya adalah
`400 invalid_request`. API key salah selalu menghasilkan `401 unauthorized`.

## 14. Troubleshooting

### 400 invalid_request pada POST /analyses

Periksa:

- Body benar-benar dikirim sebagai JSON.
- `timeframe` adalah string, misalnya `"60"`.
- `X-User-Id` tepat 64 karakter hex.
- `Idempotency-Key` panjang 8–80 dan tidak mengandung underscore/spasi.
- Nilai enum sama persis dengan daftar yang didukung.

### 401 unauthorized

- `TRADE_PILOT_API_KEY` backend belum terisi.
- Header harus bernama `X-Api-Key`.
- Container belum direstart setelah perubahan environment.
- Key BFF dan backend berbeda.

### 402 insufficient_credit

Saldo mode sudah habis. Periksa `/credits?mode=...`, allowance environment,
dan `resetsAt`.

### 403 access_denied

Mode request tidak ada pada `X-Allowed-Modes`. Header ini harus dibentuk dari
hasil pemeriksaan akun trading, bukan input bebas browser.

### 409 idempotency_conflict

Gunakan key baru untuk payload baru. Jangan menggunakan satu key global untuk
semua tombol Analisa.

### 503 analysis_unavailable

Periksa:

- `OPENAI_API_KEY` sudah valid.
- Feed historical dan live price dapat dijangkau.
- Instrumen/timeframe memiliki data indikator.
- Log container: `docker compose logs --tail 100 app`.

### Response menampilkan halaman HTML

Pastikan URL mengandung `/v1/trade-pilot`. Root `http://localhost:5000/`
adalah aplikasi web.

## 15. Keamanan production

- Rotasi API key yang pernah ditempel ke chat, tiket, screenshot, atau log.
- Simpan key pada secret manager/Replit Secrets, bukan `.replit` atau Git.
- Jangan mengirim API key dari browser.
- Gunakan HTTPS untuk backend dan webhook.
- Batasi jaringan/IP BFF jika infrastruktur mendukung.
- Gunakan secret berbeda untuk inbound Trade Pilot API dan outbound webhook.
- Jangan mencatat `X-Api-Key` atau raw email.
- Pertahankan validasi akun demo/real di BFF dan kirim `X-Allowed-Modes`.

## 16. Batasan versi saat ini

- `OPENAI_API_KEY` wajib untuk menjalankan analisis live.
- Alert eksternal membutuhkan webhook BFF; FCM/Web Push akun lama tidak dapat
  langsung digunakan karena Trade Pilot hanya menerima opaque user ID.
- Status `invalid` dan refund kredit otomatis belum memiliki alur admin.
- Monthly menggunakan konteks weekly karena feed candle monthly belum ada.
- Scheduler berada di proses API dan perlu strategi single-worker untuk
  deployment multi-replica.
- Integrasi route BFF `/api/client-area/trade-pilot/*` berada di repository
  `get-sgb`, bukan repository ini.

## 17. Checklist integrasi get-sgb

- [ ] Set `TRADE_PILOT_API_URL` dan `TRADE_PILOT_API_KEY` sebagai server-only.
- [ ] Bentuk `X-User-Id` dengan HMAC-SHA256 yang stabil.
- [ ] Validasi session dan akun demo/real sebelum request backend.
- [ ] Selalu kirim `X-Allowed-Modes`.
- [ ] Buat idempotency key baru per aksi analisis dan pertahankan saat retry.
- [ ] Terapkan timeout 10 detik untuk read dan 30 detik untuk analisis.
- [ ] Tangani seluruh standard error code.
- [ ] Jangan expose API key dalam bundle/browser/network request frontend.
- [ ] Implementasikan receiver webhook jika price alert akan mengirim push.
- [ ] Uji demo dan real sebagai namespace kredit/history yang terpisah.
