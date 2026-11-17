import type { Registry } from "../engine/types/index.ts";

// A WeakMap rather than a process-global registry: test files boot several
// stacks in one process, each with its own Registry. Keys are TenantDbs, per-grant
// runner proxies and the app connections bound via bindAppProjectionRegistry, with
// everything derived from them. Every test stack owns its connections, so no
// registry leaks across stacks; a global registry stays ruled out.
const bindings = new WeakMap<object, Registry>();

export function bindProjectionRegistry(target: object, registry: Registry): void {
  bindings.set(target, registry);
}

// WeakMap.get never reads a property off target — safe for fail-closed guard Proxies.
export function projectionRegistryOf(target: object): Registry | undefined {
  return bindings.get(target);
}
