import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const connectionString = process.env.DATABASE_URL;

const sslMode = (process.env.PGSSLMODE ?? "").toLowerCase();
const sslDisabled =
  /[?&]sslmode=disable/i.test(connectionString) || sslMode === "disable";
const needsSsl =
  !sslDisabled &&
  (/[?&]sslmode=(require|verify-ca|verify-full)/i.test(connectionString) ||
    ["require", "verify-ca", "verify-full"].includes(sslMode) ||
    process.env.NODE_ENV === "production");

if (sslDisabled && process.env.NODE_ENV === "production") {
  console.warn(
    "[db] PGSSLMODE=disable in production — database transport is NOT encrypted. Only use this on a trusted private container network.",
  );
}

// SSL safety: default to strict certificate verification. Only disable it
// when the operator explicitly opts in via PGSSL_INSECURE=true (e.g. for a
// self-signed dev DB). Disabling verification in production opens the door
// to MITM on the database transport, so we log loudly when it happens.
const sslInsecure = process.env.PGSSL_INSECURE === "true";
if (sslInsecure && process.env.NODE_ENV === "production") {
  console.warn(
    "[db] PGSSL_INSECURE=true in production — TLS certificate verification is DISABLED. This is unsafe; only use it with a trusted private network.",
  );
}

export const pool = new Pool({
  connectionString,
  ...(needsSsl
    ? { ssl: { rejectUnauthorized: sslInsecure ? false : true } }
    : {}),
  max: Number(process.env.PGPOOL_MAX ?? 10),
  // Keep idle timeout at the pg default (10s) so we don't hold idle
  // connections longer than necessary and so behavior matches what the
  // existing test suite was tuned against.
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
});

pool.on("error", (err) => {
  // Managed Postgres providers (Neon, etc.) drop idle TCP connections
  // periodically. Without a listener, the unhandled `error` event would
  // crash the Node process. Logging keeps the pool resilient — `pg` will
  // transparently open a new connection on the next query.
  console.error("[db] idle pool client error:", err.message);
});

export const db = drizzle(pool, { schema });
export type DB = typeof db;

export * from "./schema";
