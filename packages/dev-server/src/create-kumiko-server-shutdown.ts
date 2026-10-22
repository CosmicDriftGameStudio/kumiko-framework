/// <reference types="bun-types" preserve="true" />
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import type { DevDbMode, DevJobRunners } from "./create-kumiko-server-stack.ts";
import { type BunServer, logError, logInfo } from "./dev-server-runtime.ts";

// The per-boot prefix is never reused, so its BullMQ keys (queues,
// repeatables, delayed jobs) would pile up in the shared Redis forever.
// Takes a prefix-less duplicate connection: SCAN returns full key names,
// which the stack client's keyPrefix would otherwise prepend a second time.
// The connection must be opened before stack.cleanup() closes the stack
// client, yet used only after it, because closing the stack's enqueuer
// queues re-writes their `meta` keys.
async function deleteEphemeralJobQueues(
  raw: TestStack["redis"]["redis"],
  jobQueueNamePrefix: string,
): Promise<void> {
  try {
    const keys: string[] = [];
    for await (const batch of raw.scanStream({
      match: `bull:${jobQueueNamePrefix}-*`,
      count: 500,
    })) {
      keys.push(...batch);
    }
    if (keys.length > 0) await raw.del(...keys);
  } finally {
    raw.disconnect();
  }
}

export type DevServerStopDeps = {
  readonly watcherAbort: AbortController;
  readonly killTailwind: (() => void) | undefined;
  readonly server: BunServer | undefined;
  readonly stack: TestStack;
  readonly devJobRunners: DevJobRunners;
  readonly dbMode: DevDbMode;
};

export function createDevServerStop(deps: DevServerStopDeps): () => Promise<void> {
  const { watcherAbort, killTailwind, server, stack, devJobRunners, dbMode } = deps;
  return async () => {
    // Stop the watcher first so no onChange callback runs during teardown;
    // otherwise removing the temporary directory could trigger process.exit(75).
    watcherAbort.abort();
    if (killTailwind) killTailwind();
    if (server !== undefined) {
      server.stop(true);
    }
    if (stack.eventDispatcher) {
      await stack.eventDispatcher.stop();
    }
    await devJobRunners.stop();
    const rawRedis = dbMode.persistentDb
      ? undefined
      : stack.redis.redis.duplicate({ keyPrefix: "" });
    await stack.cleanup();
    if (rawRedis) await deleteEphemeralJobQueues(rawRedis, dbMode.jobQueueNamePrefix);
  };
}

function stopAndExitOnCrash(
  event: "uncaughtException" | "unhandledRejection",
  stop: () => Promise<void>,
): (err: unknown) => Promise<void> {
  return async (err) => {
    logError(`[kumiko-server] ${event} — cleaning up…`, err);
    try {
      await stop();
    } finally {
      process.exit(1);
    }
  };
}

// Without these handlers, repeated dev restarts leak Postgres pools, leave
// the Tailwind watcher as an orphan, and leave temporary clients behind in
// persistent mode; a crash cleans up the same way before exiting nonzero.
export function installDevSignalHandlers(stop: () => Promise<void>): void {
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, async () => {
      logInfo(`[kumiko-server] ${sig} — cleaning up…`);
      await stop();
      process.exit(0);
    });
  }
  process.on("uncaughtException", stopAndExitOnCrash("uncaughtException", stop));
  process.on("unhandledRejection", stopAndExitOnCrash("unhandledRejection", stop));
}
