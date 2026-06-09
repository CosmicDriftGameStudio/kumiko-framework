// Command-input schemas for the tenant write handlers, re-exposed for
// external consumers — primarily migration mappers that need to write events
// directly into core streams via `eventStore.appendRaw` (Marten-bypass) and
// must validate their payloads against the exact handler contract.
//
// IMPORTANT — schema vs. event payload:
//   The schema below describes the **command input** (what `dispatch()` accepts).
//   The actual event payload that lands in the `events` table is derived from
//   it by the CrudExecutor (see `db/event-store-executor.ts`):
//     - `tenant.created` payload   = command minus the optional `id` field,
//                                    `applyDefaults` applied, sensitive fields
//                                    stripped, compound types flattened
//                                    (locatedTimestamp → 2 cols, money → cents).
//     - `tenant.updated` payload   = `{ changes, previous, version }` (different shape)
//     - `tenant.archived/disabled` = `{ previous }`
//
//   Migration mappers writing `tenant.created` directly via `appendRaw` MUST
//   replicate strip-id themselves — `aggregateId` lives on the event row, not
//   in `payload`. Tenant + user have no compound types or sensitive fields
//   today, but new fields could change that — keep the executor as the
//   reference if the mapper output ever diverges from a replayed read-model.

import { addMemberWrite } from "./handlers/add-member.write";
import { createWrite } from "./handlers/create.write";
import { disableWrite } from "./handlers/toggle-enabled.write";
import { removeMemberWrite } from "./handlers/remove-member.write";
import { updateWrite } from "./handlers/update.write";
import { updateMemberRolesWrite } from "./handlers/update-member-roles.write";

export const TenantCommandSchemas = {
  create: createWrite.schema,
  update: updateWrite.schema,
  disable: disableWrite.schema,
  addMember: addMemberWrite.schema,
  removeMember: removeMemberWrite.schema,
  updateMemberRoles: updateMemberRolesWrite.schema,
} as const;
