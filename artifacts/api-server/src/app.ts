import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import router from "./routes";
import tradePilotRouter from "./routes/trade-pilot";
import { logger } from "./lib/logger";

const app: Express = express();

app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// Store-readiness hardening: reflecting `origin: true` for every request
// means ANY website can make credentialed (cookie-bearing) requests to
// this API on a logged-in user's behalf — CORS is the only thing standing
// between "site X reads your session" and not. The production app is
// same-origin (the api-server serves the ai-trading SPA itself, see
// below), so the only *legitimate* cross-origin browser callers are the
// configured published domains plus local dev servers. Native mobile HTTP
// clients are unaffected either way — CORS is a browser-only mechanism.
const PRODUCTION_ORIGIN = "https://tradepilot.id";
const DEV_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function getConfiguredReplitOrigins(
  domainLists: readonly (string | undefined)[],
): Set<string> {
  const origins = new Set<string>();

  for (const domainList of domainLists) {
    for (const domain of domainList?.split(",") ?? []) {
      const value = domain.trim();
      if (!value) continue;

      try {
        const url = new URL(value.includes("://") ? value : `https://${value}`);
        if (url.protocol === "https:") origins.add(url.origin);
      } catch {
        // An invalid environment value must not accidentally widen CORS.
      }
    }
  }

  return origins;
}

export function getConfiguredPublicBaseOrigin(
  value: string | undefined,
): string | undefined {
  if (!value?.trim()) return undefined;

  try {
    const url = new URL(value.trim());
    const isLocalHttp =
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1");

    if (url.protocol === "https:" || isLocalHttp) return url.origin;
  } catch {
    // Invalid values must not widen the CORS allowlist.
  }

  return undefined;
}

// In deployed artifacts REPLIT_DOMAINS contains the published domains.
// In the workspace shell it contains the development domain, while Expo web
// previews use their own exact runtime domain. Keep all exact sources to
// support previews and published deployments without allowing wildcard
// Replit domains.
const REPLIT_RUNTIME_ORIGINS = getConfiguredReplitOrigins(
  [
    process.env["REPLIT_DOMAINS"],
    process.env["REPLIT_DEV_DOMAIN"],
    process.env["REPLIT_EXPO_DEV_DOMAIN"],
  ],
);
const PUBLIC_BASE_ORIGIN = getConfiguredPublicBaseOrigin(
  process.env["PUBLIC_BASE_URL"],
);

app.use(
  cors({
    origin(origin, callback) {
      // No Origin header at all (native apps, curl, server-to-server) —
      // nothing for a browser-enforced CORS check to protect here.
      if (!origin) return callback(null, true);
      if (origin === PRODUCTION_ORIGIN) return callback(null, true);
      if (origin === PUBLIC_BASE_ORIGIN) return callback(null, true);
      if (REPLIT_RUNTIME_ORIGINS.has(origin)) return callback(null, true);
      if (
        process.env["NODE_ENV"] !== "production" &&
        DEV_ORIGIN_PATTERN.test(origin)
      ) {
        return callback(null, true);
      }
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);
app.use(cookieParser());
app.use(
  express.json({
    // Stashes the exact raw bytes DOKU sent onto req.rawBody, alongside the
    // normal parsed req.body — POST /topups/doku/notify's signature check
    // hashes the raw body verbatim (DOKU signs the literal bytes it sent;
    // re-serializing the parsed JSON could reorder keys/whitespace and
    // break the digest). See lib/doku.ts.
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true }));

app.use("/v1/trade-pilot", tradePilotRouter);
app.use("/api", router);

// In production the api-server also serves the ai-trading SPA so the
// whole app runs as a single Cloud Run service on a single port.
if (process.env["NODE_ENV"] === "production") {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const staticDir =
    process.env["STATIC_DIR"] ??
    path.resolve(here, "..", "..", "ai-trading", "dist", "public");

  if (existsSync(staticDir)) {
    app.use(express.static(staticDir, { index: false }));
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== "GET") return next();
      if (req.path.startsWith("/api")) return next();
      // Only serve index.html for navigation requests — let real asset
      // misses 404 normally so bundle-mismatch bugs are visible instead
      // of silently returning HTML with a 200.
      if (path.extname(req.path) !== "") return next();
      const accept = req.headers.accept ?? "";
      if (accept !== "" && !accept.includes("text/html") && !accept.includes("*/*")) {
        return next();
      }
      res.sendFile(path.join(staticDir, "index.html"));
    });
    logger.info({ staticDir }, "Serving SPA static assets");
  } else {
    logger.warn(
      { staticDir },
      "STATIC_DIR not found — SPA will not be served from api-server",
    );
  }
}

export default app;
