import type { UserLiveSignals } from "@cosmicdrift/kumiko-types/handlers";
import type { TenantId } from "@cosmicdrift/kumiko-types/identifiers";
import type { SseBroker } from "../api/sse-broker.ts";
import { tenantChannel } from "../engine/constants.ts";
import type { Logger } from "../logging/types.ts";
import type { AfterCommitHook } from "./dispatcher-utils.ts";

// The tenant is fixed to the caller's own: a handler can address users, never another tenant's channel.
// Frames carry `data.userId` and no aggregateType, so sse-route delivers each only to its addressee.
// In a write transaction the frame goes out after the commit and a rollback discards it; without
// a commit sink it goes out at once.
export function createUserLiveSignals(
  sseBroker: SseBroker,
  tenantId: TenantId,
  log: Pick<Logger, "warn">,
  scheduleAfterCommit?: (hook: AfterCommitHook) => void,
): UserLiveSignals {
  const pushNow: UserLiveSignals["push"] = async (userIds, signal) => {
    await Promise.all(
      [...new Set(userIds)].map(async (userId) => {
        try {
          await sseBroker.pushToChannel(tenantChannel(tenantId), {
            type: signal.type,
            data: { userId, entity: signal.entity, id: signal.id },
          });
        } catch (err) {
          log.warn(`live signal "${signal.type}" could not be pushed`, { err });
        }
      }),
    );
  };
  return {
    async push(userIds, signal) {
      if (scheduleAfterCommit === undefined) return pushNow(userIds, signal);
      scheduleAfterCommit(() => pushNow(userIds, signal));
    },
  };
}
