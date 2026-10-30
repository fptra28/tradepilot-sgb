# Trade Pilot v1 configuration

Dokumentasi lengkap: [`TRADE_PILOT_V1_FULL_DOCUMENTATION.md`](./TRADE_PILOT_V1_FULL_DOCUMENTATION.md).

Panduan API, contoh request/response, arsitektur akun, dan troubleshooting
lengkap tersedia di [`TRADE_PILOT_V1_API_GUIDE.md`](./TRADE_PILOT_V1_API_GUIDE.md).

## Backend (`SGB-TP`)

The API is served at:

```text
http://localhost:5000/v1/trade-pilot
```

Required runtime environment:

```env
TRADE_PILOT_API_KEY=<server-to-server secret>
TRADE_PILOT_DEMO_ALLOWANCE=5
TRADE_PILOT_REAL_ALLOWANCE=50
TRADE_PILOT_DEMO_CREDIT_PERIOD=daily
TRADE_PILOT_REAL_CREDIT_PERIOD=monthly
```

Optional tuning:

```env
TRADE_PILOT_AI_CACHE=on                    # share AI output per instrument+timeframe+candle (off to disable)
TRADE_PILOT_MAX_CONCURRENT_ANALYSES=1      # per user
TRADE_PILOT_MAX_ANALYSES_PER_MINUTE=10     # per user, 429 rate_limited beyond this
```

Optional alert delivery:

```env
TRADE_PILOT_ALERT_WEBHOOK_URL=https://get-sgb.example/api/internal/trade-pilot/alerts
TRADE_PILOT_ALERT_WEBHOOK_API_KEY=<separate webhook secret>
```

When the webhook URL is empty, alert subscriptions and triggered levels are
still stored, but no outbound push callback is made.

## get-sgb BFF

Configure these as server-only variables:

```env
TRADE_PILOT_API_BASE_URL=http://localhost:5000
TRADE_PILOT_API_KEY=<same secret as the backend>
TRADE_PILOT_USER_ID_SECRET=<separate, never-rotated HMAC secret for userId>
TRADE_PILOT_DATA_SOURCE=api   # or mock
```

Do not prefix any of these with `NEXT_PUBLIC_`. The BFF calls
`${TRADE_PILOT_API_BASE_URL}/v1/trade-pilot` and must send
`Authorization: Bearer ${TRADE_PILOT_API_KEY}`, the 64-character HMAC
`X-TradePilot-User`, `Accept-Language: id|en`, and optionally `X-Allowed-Modes`
and `X-Request-Id`.

If get-sgb runs in another Docker container, replace `localhost` with the
backend service hostname. If it runs in Docker while this backend runs on the
host, use `host.docker.internal`.

## Replit deployment

Store `TRADE_PILOT_API_KEY` and any webhook secret in Replit Secrets. Do not
write real credentials into `.replit`, `replit.md`, or an `.env.example` file.

## Database

Provision the v1 tables by running, in order:

```text
lib/db/migrations/0001_trade_pilot_v1.sql
lib/db/migrations/0002_trade_pilot_contract_alignment.sql
lib/db/migrations/0003_tp_admin_audit.sql
lib/db/migrations/0004_tp_admin_audit_details.sql
lib/db/migrations/0005_tp_settings.sql
```

The migration is intentionally not executed automatically because it mutates
the database and must be applied to the intended environment explicitly.
