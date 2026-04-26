import { defineFeature, type FeatureDefinition } from "@kumiko/framework/engine";
import { listQuery } from "./handlers/list.query";

// Audit feature — exposes a filtered read over the framework's event log.
//
// Design: the event-store IS the audit trail (every entity write produces
// an event with who/when/what/where/delta). This feature adds no persistence,
// no projection, no cursor — it's a single privileged query handler over
// the existing `events` table. See handlers/list.query.ts for the filter
// surface.
//
// Retention lives elsewhere. Events are kept indefinitely as the source of
// truth for state; archive or compress policies are a separate concern
// (tracked with the snapshot/archive infrastructure that already exists in
// the framework).
export function createAuditFeature(): FeatureDefinition {
  return defineFeature("audit", (r) => {
    const queries = {
      list: r.queryHandler(listQuery),
    };
    return { queries };
  });
}
