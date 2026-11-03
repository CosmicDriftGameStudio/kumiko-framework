// Removes chosen keys from the headers of stored events. For personal data that was written into
// event headers, which crypto-shredding cannot reach (only payload fields are encrypted).

import type { DbConnection } from "../db/connection.ts";
import { removeEventHeaderKey } from "../db/queries/event-store-payload-scrub.ts";
import { runInSystemRowLevelSecurityScope } from "../db/row-level-security-scope.ts";
import { assertReason } from "../engine/escape-hatch-reason.ts";
import { createFallbackLogger } from "../logging/utils.ts";

export type ScrubEventHeaderOptions = {
  readonly eventTypes: readonly string[];
  readonly keys: readonly string[];
  // Why these headers have to go; refused when it is a placeholder.
  readonly reason: string;
  // Counts what would be removed and writes nothing.
  readonly dryRun?: boolean;
};

export type ScrubEventHeaderResult = {
  readonly removedKeys: number;
};

// Headers are not part of any projection or snapshot, so no rebuild follows.
export function scrubEventHeaderKeys(
  db: DbConnection,
  options: ScrubEventHeaderOptions,
): Promise<ScrubEventHeaderResult> {
  assertReason("scrubEventHeaderKeys", options.reason);
  if (options.eventTypes.length === 0 || options.keys.length === 0) {
    throw new Error("scrubEventHeaderKeys: name at least one event type and one header key");
  }
  return runInSystemRowLevelSecurityScope(
    "event header scrub rewrites event types across all tenants",
    async () => {
      let removedKeys = 0;
      for (const key of options.keys) {
        removedKeys += await removeEventHeaderKey(db, {
          eventTypes: options.eventTypes,
          key,
          dryRun: options.dryRun === true,
        });
      }
      const log = createFallbackLogger("event-header-scrub");
      // A real run is an audit trail of a destructive cross-tenant rewrite, so it must survive prod log levels.
      (options.dryRun ? log.debug : log.info)?.("Event header scrub finished", {
        dryRun: options.dryRun === true,
        eventTypes: options.eventTypes,
        keys: options.keys,
        reason: options.reason,
        removedKeys,
      });
      return { removedKeys };
    },
  );
}
