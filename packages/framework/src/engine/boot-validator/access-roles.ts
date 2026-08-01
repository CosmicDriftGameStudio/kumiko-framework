import type { FeatureDefinition } from "../types";

const BUILTIN_ROLES = new Set(["all", "system"]);

export function warnOnUniqueAccessRoles(features: readonly FeatureDefinition[]): void {
  // role → set of distinct handler identifiers using it
  const roleHandlers = new Map<string, Set<string>>();

  for (const f of features) {
    const handlerGroups = [
      { type: "write", defs: f.writeHandlers },
      { type: "query", defs: f.queryHandlers },
      { type: "stream", defs: f.streamHandlers },
    ] as const;

    for (const { type, defs } of handlerGroups) {
      for (const [handlerName, def] of Object.entries(defs)) {
        if (!def.access || !("roles" in def.access)) continue;
        const identifier = `${f.name}:${type}:${handlerName}`;
        for (const role of def.access.roles) {
          let handlers = roleHandlers.get(role);
          if (!handlers) {
            handlers = new Set();
            roleHandlers.set(role, handlers);
          }
          handlers.add(identifier);
        }
      }
    }
  }

  for (const [role, handlers] of roleHandlers) {
    if (BUILTIN_ROLES.has(role)) continue;
    if (handlers.size !== 1) continue;
    const [identifier] = handlers;
    // biome-ignore lint/suspicious/noConsole: boot-time dev hint, no logger available yet
    console.warn(
      `[kumiko:boot] Access role "${role}" is only used by one handler (${identifier}). ` +
        `This is often a typo — the role is unknown to every other handler in the boot scan. ` +
        `If this is intentional, ignore this warning.`,
    );
  }
}
