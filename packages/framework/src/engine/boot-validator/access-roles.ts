import { normalizeAccessEntry } from "../ownership";
import type { FeatureDefinition } from "../types";

const BUILTIN_ROLES = new Set(["all", "system"]);

function addRole(roleHandlers: Map<string, Set<string>>, role: string, identifier: string): void {
  let handlers = roleHandlers.get(role);
  if (!handlers) {
    handlers = new Set();
    roleHandlers.set(role, handlers);
  }
  handlers.add(identifier);
}

function addHandlerRoles(roleHandlers: Map<string, Set<string>>, f: FeatureDefinition): void {
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
        addRole(roleHandlers, role, identifier);
      }
    }
  }
}

function addConfigKeyRoles(roleHandlers: Map<string, Set<string>>, f: FeatureDefinition): void {
  for (const [key, keyDef] of Object.entries(f.configKeys ?? {})) {
    const identifier = `${f.name}:config:${key}`;
    for (const role of [...keyDef.access.read, ...keyDef.access.write]) {
      addRole(roleHandlers, role, identifier);
    }
  }
}

function addEntityFieldRoles(roleHandlers: Map<string, Set<string>>, f: FeatureDefinition): void {
  for (const [entityName, entity] of Object.entries(f.entities ?? {})) {
    for (const [fieldName, field] of Object.entries(entity.fields)) {
      const identifier = `${f.name}:entity:${entityName}.${fieldName}`;
      const readRoles = Object.keys(normalizeAccessEntry(field.access?.read) ?? {});
      const writeRoles = Object.keys(normalizeAccessEntry(field.access?.write) ?? {});
      for (const role of [...readRoles, ...writeRoles]) {
        addRole(roleHandlers, role, identifier);
      }
    }
  }
}

// A single "exactly one handler" heuristic over-counts by construction:
// legitimate fine-grained roles (a role scoped to one admin endpoint on
// purpose) are the normal case, not a typo — and until every access
// surface is scanned, a role can look unique here while it's really used
// elsewhere (configKeys / entity+field access), a false positive in the
// other direction. Both is why this stays opt-in (#1711) rather than a
// default-on prod warning.
export function warnOnUniqueAccessRoles(features: readonly FeatureDefinition[]): void {
  // role → set of distinct identifiers using it, across every access
  // surface — write/query/stream handlers, config-key access, and
  // entity/field-level access rules.
  const roleHandlers = new Map<string, Set<string>>();

  for (const f of features) {
    addHandlerRoles(roleHandlers, f);
    addConfigKeyRoles(roleHandlers, f);
    addEntityFieldRoles(roleHandlers, f);
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
