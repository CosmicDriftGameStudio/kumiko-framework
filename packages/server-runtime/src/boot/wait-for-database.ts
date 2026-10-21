import { type DbConnection, extractPgError, tableExists } from "@cosmicdrift/kumiko-framework/db";

const TRANSIENT_CODES: ReadonlySet<string> = new Set([
  "53300", // too_many_connections
  "57P03", // cannot_connect_now (startup / recovery)
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "CONNECTION_CLOSED",
  "CONNECT_TIMEOUT",
  "CONNECTION_DESTROYED",
]);

const CONNECTION_EXCEPTION_CLASS = "08";

export function isTransientConnectionError(error: unknown): boolean {
  const code = extractPgError(error)?.code;
  if (code === undefined) return false;
  return TRANSIENT_CODES.has(code) || code.startsWith(CONNECTION_EXCEPTION_CLASS);
}

export const WAIT_FOR_DATABASE_INITIAL_BACKOFF_MS = 1_000;
export const WAIT_FOR_DATABASE_MAX_BACKOFF_MS = 15_000;
// ponytail: the kubelet liveness probe restarts a pod without an open port after ~105s anyway,
// so waiting longer buys nothing. Upgrade: make this configurable via env once a deployment
// needs a longer outage window (e.g. a managed-DB failover that takes minutes).
export const WAIT_FOR_DATABASE_DEADLINE_MS = 90_000;

export type WaitForDatabaseOptions = {
  readonly processName: string;
  readonly log?: (line: string) => void;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
};

function logToConsole(line: string): void {
  // biome-ignore lint/suspicious/noConsole: boot-time progress hint, no logger configured this early
  console.log(line);
}

function sleepReal(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Postgres can be briefly unreachable at boot (connection slots exhausted, failover, restart).
// Crashing makes the orchestrator restart-loop and adds connection churn; wait and retry instead.
export async function waitForDatabase(
  db: DbConnection,
  options: WaitForDatabaseOptions,
): Promise<void> {
  await waitUntilDatabaseReachable(() => tableExists(db, "pg_catalog.pg_class"), options);
}

export async function waitUntilDatabaseReachable<T>(
  ping: () => Promise<T>,
  options: WaitForDatabaseOptions,
): Promise<T> {
  const { processName, log = logToConsole, sleep = sleepReal, now = Date.now } = options;
  const deadline = now() + WAIT_FOR_DATABASE_DEADLINE_MS;
  let backoffMs = WAIT_FOR_DATABASE_INITIAL_BACKOFF_MS;

  for (let attempt = 1; ; attempt++) {
    try {
      return await ping();
    } catch (error) {
      if (!isTransientConnectionError(error)) throw error;
      const remainingMs = deadline - now();
      if (remainingMs <= 0) throw error;
      const waitMs = Math.min(backoffMs, remainingMs);
      const code = extractPgError(error)?.code ?? "unknown";
      log(
        `[${processName}] database not reachable (code ${code}, attempt ${attempt}), retrying in ${waitMs}ms…`,
      );
      await sleep(waitMs);
      backoffMs = Math.min(backoffMs * 2, WAIT_FOR_DATABASE_MAX_BACKOFF_MS);
    }
  }
}
