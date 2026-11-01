import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { PRESENCE_FEATURE } from "@cosmicdrift/kumiko-types/presence-types";
import { createHeartbeatHandler } from "./handlers/heartbeat.write.ts";
import { createLeaveHandler } from "./handlers/leave.write.ts";
import { createListQuery } from "./handlers/list.query.ts";
import { type PresenceOptions, resolvePresenceSettings } from "./options.ts";
import type { PresenceRuntime } from "./room.ts";
import { createMemoryPresenceStore } from "./store.ts";

export function createPresenceFeature(options: PresenceOptions = {}): FeatureDefinition {
  const settings = resolvePresenceSettings(options);
  // Without Redis the room lives in this process only, which is right for a single instance.
  const runtime: PresenceRuntime = { settings, memoryStore: createMemoryPresenceStore() };
  const access = { roles: settings.roles };

  return defineFeature(PRESENCE_FEATURE, (r) => {
    r.describe(
      'Who else is on this record right now: a browser sends a heartbeat every 15 seconds for one row of an allow-listed entity and gets the other viewers and editors back, with a live signal to them on a change. State is ephemeral (Redis hash per tenant, entity and row, in-memory without Redis), keyed by the session tenant, expires after ttlSeconds without a heartbeat and holds user ids only; display names are looked up per response. A caller sees presence only for rows visible to them. Mount with createPresenceFeature({ entities: ["task"] }).',
    );
    r.uiHints({ displayLabel: "Presence", category: "communication", recommended: false });
    r.writeHandler(createHeartbeatHandler(runtime, access));
    r.writeHandler(createLeaveHandler(runtime, access));
    r.queryHandler(createListQuery(runtime, access));
  });
}
