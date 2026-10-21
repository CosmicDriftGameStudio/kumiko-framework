import type { AccessRule, SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { AccessDeniedError } from "@cosmicdrift/kumiko-framework/errors";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import type { TestStack } from "../stack/test-stack.ts";

// Test-only helper: extracts the role list from a role-based AccessRule,
// narrowing the union safely. Throws when the rule is openToAll or missing —
// the tests that call this always expect roles, and a clear error beats a
// cryptic undefined assertion downstream.
export function rolesOf(access: AccessRule | undefined): readonly string[] {
  if (!access) {
    throw new Error("expected role-based access rule, got undefined");
  }
  if (!("roles" in access)) {
    throw new Error("expected role-based access rule, got openToAll");
  }
  return access.roles;
}

const PROBE_ROLE = "access-contract-probe";

type CheckedHandlerCounts = { checkedWriteHandlers: number; checkedQueryHandlers: number };

function isRoleRestricted(access: AccessRule | undefined): boolean {
  return access !== undefined && "roles" in access && access.roles.length > 0;
}

async function deniedOutcome(res: Response): Promise<string | undefined> {
  const rawBody = await res.json().catch(() => undefined);
  const body = rawBody as { error?: { code?: unknown } | string } | undefined; // @cast-boundary engine-bridge
  const code =
    typeof body?.error === "object" && typeof body.error.code === "string"
      ? body.error.code
      : undefined;
  if (res.status === 403 && code === ACCESS_DENIED_CODE) return undefined;
  return `HTTP ${res.status} ${code ?? "ok"}`;
}

const ACCESS_DENIED_CODE = new AccessDeniedError().code;

/**
 * Contract test: every role-restricted write/query handler in the stack rejects
 * a signed-in caller who holds none of its roles with 403 access_denied, over
 * real HTTP. Roles are checked centrally before payload parsing (pre-handler
 * gates / dispatch-query), so an empty payload is enough. openToAll handlers
 * and handlers without access are skipped. Throws once with all deviations;
 * `minimumHandlerCount` guards against an empty registry walk passing silently.
 */
export async function expectRoleRestrictedHandlersDenyForeignRole(
  stack: Pick<TestStack, "registry" | "http">,
  options: { minimumHandlerCount?: number; probeUser?: SessionUser } = {},
): Promise<CheckedHandlerCounts> {
  const probe = options.probeUser ?? createTestUser({ roles: [PROBE_ROLE] });
  const minimumHandlerCount = options.minimumHandlerCount ?? 1;
  const deviations: string[] = [];
  let checkedWriteHandlers = 0;
  let checkedQueryHandlers = 0;

  for (const [handlerName, handler] of stack.registry.getAllWriteHandlers()) {
    if (!isRoleRestricted(handler.access)) continue;
    checkedWriteHandlers++;
    const outcome = await deniedOutcome(await stack.http.write(handlerName, {}, probe));
    if (outcome) deviations.push(`write ${handlerName}: ${outcome}`);
  }
  for (const [handlerName, handler] of stack.registry.getAllQueryHandlers()) {
    if (!isRoleRestricted(handler.access)) continue;
    checkedQueryHandlers++;
    const outcome = await deniedOutcome(await stack.http.query(handlerName, {}, probe));
    if (outcome) deviations.push(`query ${handlerName}: ${outcome}`);
  }

  const checked = checkedWriteHandlers + checkedQueryHandlers;
  if (checked < minimumHandlerCount) {
    throw new Error(
      `expected at least ${minimumHandlerCount} role-restricted handlers, checked ${checked}`,
    );
  }
  if (deviations.length > 0) {
    throw new Error(
      `${deviations.length} role-restricted handler(s) did not answer 403 ${ACCESS_DENIED_CODE}:\n${deviations.join("\n")}`,
    );
  }
  return { checkedWriteHandlers, checkedQueryHandlers };
}
