import type { Registry } from "../engine/types/index.js";

// A WeakMap rather than a process-global registry: test files boot several
// stacks in one process, each with its own Registry. Keys are TenantDbs and
// per-grant runner proxies — never the shared pool or tx handle, which would
// leak one dispatcher's registry onto sibling TenantDbs.
const bindings = new WeakMap<object, Registry>();

export function bindProjectionRegistry(target: object, registry: Registry): void {
  bindings.set(target, registry);
}

// WeakMap.get never reads a property off target — safe for fail-closed guard Proxies.
export function projectionRegistryOf(target: object): Registry | undefined {
  return bindings.get(target);
}
