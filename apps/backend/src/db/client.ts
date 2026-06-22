import { PrismaClient } from "@prisma/client";

/**
 * Connection-pool sizing for a single-process app (bot runtime + Fastify API
 * share one process — see src/index.ts). Prisma's default is `num_cpus * 2 + 1`,
 * which overshoots Postgres' default `max_connections` on big boxes and
 * under-provisions on small shared hosts. Pin it and bound how long we wait for
 * a free connection so a burst of locked transactions surfaces a fast error
 * rather than piling up.
 *
 * Note on statement_timeout: Prisma does NOT forward arbitrary Postgres GUCs
 * (statement_timeout, idle_in_transaction_session_timeout) from the connection
 * string — only connection_limit, pool_timeout, schema, socket_timeout,
 * connect_timeout, pgbouncer, and SSL params are honoured. So statement_timeout
 * is set server-side via the docker-compose `command:` (postgres -c ...) and
 * applies to every session that way. Do not add it back to the URL; it would be
 * a silent no-op and a misleading safety net. The real backstop for runaway
 * ledger SUMs is the new indexes + (eventually) materialised balances.
 */
export function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    datasources: {
      db: {
        url: withPoolParams(process.env.DATABASE_URL),
      },
    },
  });
}

function withPoolParams(databaseUrl: string | undefined): string | undefined {
  if (!databaseUrl) {
    return databaseUrl;
  }

  // Prisma's connection-string parser is more lenient than the WHATWG URL parser
  // used here — e.g. it tolerates some unencoded characters in passwords that
  // new URL() would reject. If a DATABASE_URL that Prisma itself could parse
  // fails this transform, fall back to the raw string (no pool params) rather
  // than crashing the process at boot. Operators wanting pool tuning should use
  // a properly percent-encoded DATABASE_URL.
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return databaseUrl;
  }

  const existing = Object.fromEntries(parsed.searchParams.entries());

  // Only set a param if the operator hasn't already pinned it in DATABASE_URL,
  // so an explicit override in .env.production always wins. These two ARE
  // honoured by Prisma's Postgres driver.
  const defaults: Record<string, string> = {
    connection_limit: "10",
    pool_timeout: "20",
  };

  for (const [key, value] of Object.entries(defaults)) {
    if (!(key in existing)) {
      parsed.searchParams.set(key, value);
    }
  }

  return parsed.toString();
}
