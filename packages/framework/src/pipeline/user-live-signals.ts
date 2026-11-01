import type { UserLiveSignals } from "@cosmicdrift/kumiko-types/handlers";
import type { TenantId } from "@cosmicdrift/kumiko-types/identifiers";
import type { SseBroker } from "../api/sse-broker.ts";
import { tenantChannel } from "../engine/constants.ts";
import type { Logger } from "../logging/types.ts";

// The tenant is fixed to the caller's own: a handler can address users, never another tenant's channel.
// Frames carry `data.userId` and no aggregateType, so sse-route delivers each only to its addressee.
export function createUserLiveSignals(
  sseBroker: SseBroker,
  tenantId: TenantId,
  log: Pick<Logger, "warn">,
): UserLiveSignals {
  return {
    async push(userIds, signal) {
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
    },
  };
}
