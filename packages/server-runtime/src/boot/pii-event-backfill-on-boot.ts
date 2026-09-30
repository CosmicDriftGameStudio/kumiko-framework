import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { Registry } from "@cosmicdrift/kumiko-framework/engine";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import { runPiiEventBackfill } from "@cosmicdrift/kumiko-framework/migrations";

export const SKIP_PII_BACKFILL_ENV = "KUMIKO_SKIP_PII_BACKFILL";

type ShutdownRegistry = {
  registerShutdownHook(name: string, fn: () => Promise<void>): void;
};

// Runs in the background instead of blocking boot: the first run after a bump
// scans the whole store and would delay readiness in proportion to its size.
// Every batch is its own transaction, so an abort at any point is safe.
export function startPiiEventBackfillOnBoot(opts: {
  readonly db: DbConnection;
  readonly registry: Registry;
  readonly lifecycle: ShutdownRegistry;
  readonly envSource: Readonly<Record<string, string | undefined>>;
}): void {
  if (opts.envSource[SKIP_PII_BACKFILL_ENV] === "1") {
    // skip: operator opted out via KUMIKO_SKIP_PII_BACKFILL
    return;
  }

  const log = createFallbackLogger("pii-event-backfill");
  const abortController = new AbortController();
  const run = runPiiEventBackfill(opts.db, opts.registry, {
    signal: abortController.signal,
  }).then(
    () => undefined,
    (e: unknown) => {
      log.error("PII event backfill crashed; it will be retried on the next boot", {
        error: e instanceof Error ? e.message : String(e),
      });
    },
  );

  opts.lifecycle.registerShutdownHook("piiEventBackfill", async () => {
    abortController.abort();
    await run;
  });
}
