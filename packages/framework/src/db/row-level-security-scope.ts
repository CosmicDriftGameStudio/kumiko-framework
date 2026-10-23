import { AsyncLocalStorage } from "node:async_hooks";
import type { TenantDbMode } from "@cosmicdrift/kumiko-types/tenant-db-types";
import type { TenantId } from "../engine/types/identifiers.ts";
import { InternalError } from "../errors/index.ts";
import { asEntityTableMeta } from "./table-introspection.ts";

export type RowLevelSecurityScope =
  | { readonly kind: "tenant"; readonly tenantId: TenantId }
  | { readonly kind: "system" };

export const SYSTEM_ROW_LEVEL_SECURITY_SCOPE: RowLevelSecurityScope = { kind: "system" };

export function tenantRowLevelSecurityScope(tenantId: TenantId): RowLevelSecurityScope {
  return { kind: "tenant", tenantId };
}

const storage = new AsyncLocalStorage<RowLevelSecurityScope>();

export function activeRowLevelSecurityScope(): RowLevelSecurityScope | undefined {
  return storage.getStore();
}

export function runInRowLevelSecurityScope<T>(scope: RowLevelSecurityScope, fn: () => T): T {
  return storage.run(scope, fn);
}

export function runInSystemRowLevelSecurityScope<T>(fn: () => T): T {
  return storage.run(SYSTEM_ROW_LEVEL_SECURITY_SCOPE, fn);
}

// Drivers may invoke callbacks outside the caller's async context; undefined re-enters "no scope".
export function runInCapturedRowLevelSecurityScope<T>(
  captured: RowLevelSecurityScope | undefined,
  fn: () => T,
): T {
  return captured === undefined ? storage.exit(fn) : storage.run(captured, fn);
}

// DDL such as CREATE INDEX CONCURRENTLY cannot run in the per-statement transaction an enforced pool opens under a scope.
export function outsideRowLevelSecurityScope<T>(fn: () => T): T {
  return storage.exit(fn);
}

export function rowLevelSecurityScopeKey(scope: RowLevelSecurityScope | undefined): string {
  if (scope === undefined) return "none";
  return scope.kind === "system" ? "system" : `tenant:${scope.tenantId}`;
}

// Global tables carry SYSTEM_TENANT_ID rows; the app layer rejects tenant writes and filters reads.
export function tenantDbRowLevelSecurityScope(
  mode: TenantDbMode,
  tenantId: TenantId,
  table?: unknown,
): RowLevelSecurityScope {
  if (mode === "system" || asEntityTableMeta(table)?.tenancy === "global") {
    return SYSTEM_ROW_LEVEL_SECURITY_SCOPE;
  }
  return tenantRowLevelSecurityScope(tenantId);
}

// A server or loop that inherits an ambient scope would run every later request fail-open.
export function assertNoActiveRowLevelSecurityScope(startingWhat: string): void {
  const active = activeRowLevelSecurityScope();
  // skip: no active scope, nothing leaked
  if (active === undefined) return;
  throw new InternalError({
    message: `${startingWhat} was started inside an active row-level-security scope (${rowLevelSecurityScopeKey(active)}); long-lived loops must start outside any scope.`,
  });
}

const scopedRunnerInners = new WeakMap<object, object>();

// A tenant db scopes each statement itself; a runner pre-scoped by a caller would override that
// scope (innermost wins) and silently run the statement under the caller's scope instead.
export function unscopedRunnerOf<T extends object>(runner: T): T;
export function unscopedRunnerOf(runner: object): object {
  return scopedRunnerInners.get(runner) ?? runner;
}

export function innerOfScopedRunner(runner: unknown): object | undefined {
  if (typeof runner !== "object" && typeof runner !== "function") return undefined;
  return runner === null ? undefined : scopedRunnerInners.get(runner);
}

const SCOPED_METHODS: ReadonlySet<PropertyKey> = new Set([
  "unsafe",
  "begin",
  "transaction",
  "savepoint",
]);

// The overload keeps the caller's runner type; the shared WeakMap can only store erased targets.
export function withRowLevelSecurityScope<T extends object>(
  runner: T,
  scope: RowLevelSecurityScope,
): T;
export function withRowLevelSecurityScope(runner: object, scope: RowLevelSecurityScope): object {
  // Innermost scope wins: re-scoping unwraps instead of stacking proxies.
  const inner = scopedRunnerInners.get(runner) ?? runner;
  const proxy = new Proxy(inner, {
    apply(target, _thisArg, args) {
      if (typeof target !== "function") {
        throw new TypeError("row-level-security scope proxy applied on a non-callable runner");
      }
      return runInRowLevelSecurityScope(scope, () => Reflect.apply(target, target, args));
    },
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      if (prop === "reserve") {
        return async (...args: unknown[]) => {
          const reserved: unknown = await Reflect.apply(value, target, args);
          if (typeof reserved !== "object" || reserved === null) return reserved;
          return withRowLevelSecurityScope(reserved, scope);
        };
      }
      if (SCOPED_METHODS.has(prop)) {
        return (...args: unknown[]) =>
          runInRowLevelSecurityScope(scope, () => Reflect.apply(value, target, args));
      }
      return value.bind(target);
    },
  });
  scopedRunnerInners.set(proxy, inner);
  return proxy;
}

export function systemScopedRunner<T extends object>(runner: T): T {
  return withRowLevelSecurityScope(runner, SYSTEM_ROW_LEVEL_SECURITY_SCOPE);
}
