import type { SessionUser } from "@cosmicdrift/kumiko-types/handlers";
import {
  type RowLevelSecurityScope,
  runInRowLevelSecurityScope,
  SYSTEM_ROW_LEVEL_SECURITY_SCOPE,
  tenantRowLevelSecurityScope,
} from "../db/row-level-security-scope.ts";
import type { Registry } from "../engine/types/index.ts";

// Handlers declared with r.systemScope() act across tenants, so a single-type dispatch of one runs system-scoped.
// The caller picks the types of a batch, so a batch is system-scoped only when every command is; each command then
// narrows or widens to its own type's scope (runInDispatchScope in runReservedCommand).
export function dispatchRowLevelSecurityScope(
  registry: Registry,
  types: readonly string[],
  user: SessionUser,
): RowLevelSecurityScope {
  return types.length > 0 && types.every((type) => registry.isHandlerSystemScoped(type))
    ? SYSTEM_ROW_LEVEL_SECURITY_SCOPE
    : tenantRowLevelSecurityScope(user.tenantId);
}

export function runInDispatchScope<T>(
  registry: Registry,
  types: readonly string[],
  user: SessionUser,
  fn: () => T,
): T {
  return runInRowLevelSecurityScope(dispatchRowLevelSecurityScope(registry, types, user), fn);
}

// Generator bodies resume in the consumer's async context, so each step re-enters the scope.
export async function* streamInDispatchScope<T>(
  scope: RowLevelSecurityScope,
  source: AsyncGenerator<T>,
): AsyncGenerator<T> {
  try {
    while (true) {
      const step = await runInRowLevelSecurityScope(scope, () => source.next());
      // skip: source exhausted
      if (step.done) return;
      yield step.value;
    }
  } finally {
    await runInRowLevelSecurityScope(scope, () => source.return(undefined));
  }
}
