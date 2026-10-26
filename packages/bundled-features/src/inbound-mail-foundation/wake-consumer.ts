import type { FeatureRegistrar } from "@cosmicdrift/kumiko-framework/engine";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { wakeMailAccount } from "./account-wake.ts";
import { InboundMailAccountStatuses } from "./constants.ts";
import { MAIL_ACCOUNT_CONNECTED_EVENT_QN, MAIL_ACCOUNT_UPDATED_EVENT_QN } from "./events.ts";

const SUPERVISOR_AUDIT_REASON = "watch_supervisor";

// Per-instance consumer: every process sees every account event, so the supervisor running in that
// process syncs a freshly connected, reconnected or re-activated mailbox immediately. Supervisor-made
// updates (watch state, health) are skipped, otherwise its own bookkeeping would trigger syncs.
// It only reaches an in-process registry and never writes to the database.
export function registerMailAccountWakeConsumer(r: FeatureRegistrar<"inbound-mail-foundation">) {
  const wakeIfActive = (
    event: Parameters<Parameters<typeof r.multiStreamProjection>[0]["apply"][string]>[0],
  ): void => {
    // skip: only an account that is active again needs an immediate sync.
    if (propertyOf(event.payload, "status") !== InboundMailAccountStatuses.active) return;
    // skip: the supervisor's own bookkeeping must not trigger another sync.
    if (event.metadata.headers?.["reason"] === SUPERVISOR_AUDIT_REASON) return;
    wakeMailAccount(event.tenantId, event.aggregateId);
  };
  r.multiStreamProjection({
    name: "mail-account-wake",
    delivery: "per-instance",
    startFrom: "now",
    runIn: "both",
    apply: {
      [MAIL_ACCOUNT_CONNECTED_EVENT_QN]: async (event) => wakeIfActive(event),
      [MAIL_ACCOUNT_UPDATED_EVENT_QN]: async (event) => wakeIfActive(event),
    },
  });
}
