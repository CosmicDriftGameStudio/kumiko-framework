import { hasAccess } from "../engine/access.js";
import { ANONYMOUS_ROLE } from "../engine/system-user.js";
import type { Registry } from "../engine/types/index.js";

const ANONYMOUS_PRINCIPAL = { roles: [ANONYMOUS_ROLE] } as const;

// Entities an anonymous /api/sse connection may receive change signals for:
// only those an anonymously callable query declares via liveEntities. No
// inference from the query name, because a signal carries the id of every
// row of the entity, including rows that query filters out (drafts).
export function collectAnonymousLiveEntities(registry: Registry): ReadonlySet<string> {
  const entities = new Set<string>();
  for (const handler of registry.getAllQueryHandlers().values()) {
    if (!hasAccess(ANONYMOUS_PRINCIPAL, handler.access)) continue;
    for (const entityName of handler.liveEntities ?? []) entities.add(entityName);
  }
  return entities;
}
