#!/usr/bin/env bun
/**
 * Guard: tenant / privilege-escalation safety. Four complementary checks.
 *
 *   A) **Role-input write handlers need an escalation test.** Any
 *      `defineWriteHandler` whose Zod schema takes a `role`/`roles` field lets
 *      the caller choose a role — the membership-role escalation surface that
 *      let a Tenant-Admin invite "SystemAdmin" and become platform admin. Such
 *      a handler MUST have a test asserting a reserved/global role is rejected:
 *      a test file that references the handler name (any of its kebab/camel/
 *      colon-segment forms) AND a reserved-role literal. Matching is repo-wide
 *      because a feature's escalation test legitimately lives in another
 *      feature's __tests__ (e.g. user:update is covered by auth's multi-roles).
 *
 *   B) **tenantIdOverride handlers must use crossTenantOverrideDenied.** A
 *      payload `tenantIdOverride` on a TenantAdmin-reachable handler is the
 *      cross-tenant escape hatch; the SystemAdmin gate must go through the
 *      shared framework helper, not an inline `roles.includes("SystemAdmin")`
 *      check that the next handler forgets.
 *
 *   C) **Membership-derived JWT mints must strip reserved roles.** Command-time
 *      validation rejects reserved roles from a membership, but a projection
 *      rebuild replays stored membership events through the apply path, not the
 *      handler — so a forbidden role can be resurrected into the projection. Any
 *      file that mints a session (`kind: "auth-session"` / a `SessionUser`
 *      literal) from a membership source (`membership.roles`/`chosen.roles`/
 *      `invitationRole`) MUST call `stripForbiddenMembershipRoles`, the
 *      read-time backstop.
 *
 *   D) **TenantAdmin-reachable writes on a global user row need a membership
 *      check.** A `ctx.db.raw` read deliberately bypasses the auto-tenant-
 *      filter because User status is global. Combined with `access.admin`
 *      (which includes the tenant-scoped TenantAdmin) and a `userId` payload,
 *      the handler acts on *someone else's* account across tenant lines, so it
 *      must gate on the target's membership in the caller's own tenant — the
 *      isSystemAdminActor + tenantMembershipsTable shape lift-restriction.
 *      write.ts uses. restrict-account.write.ts shipped without it.
 *
 * All four are tripwires: false-negatives (a weak name match) are tolerated, a
 * false-positive on the clean repo is not. Detection stays conservative.
 *
 * Usage:
 *   bun guards/guard-tenant-escalation.ts
 */

import * as path from "node:path";
import { type Node, type SourceFile, SyntaxKind } from "ts-morph";
import { type AstGuard, runStandalone, type ScanSpec } from "./_lib/guard-kit";
import { literalStringOf, mentionsAsWord, nameForms } from "./_lib/handler-name-forms";

const ROOT = process.cwd();

const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["ts"],
  frameworkWithin: ["packages/*/src/**", "samples/**"],
};

const TEST_FILE = /\.test\.ts$/;

// Quoted forms — a test "rejects this role" assertion carries the literal.
const RESERVED_ROLE_LITERALS = ['"SystemAdmin"', '"system"', '"all"', '"anonymous"'];

type RoleHandler = { name: string; file: string; line: number };

// A `schema:` property that references an outlined const (`schema:
// CancelInvitationSchema`) has no `role:`/`roles:` text of its own — the field
// lives in the const's declaration. Resolving the identifier to its
// declaration covers that ~43% of write handlers (#1556-adjacent bug: a
// text-only check silently skips them). Falls back to the property's own text
// when the initializer isn't a resolvable identifier.
function resolvedSchemaText(schemaProp: Node): string {
  const init = schemaProp.asKind(SyntaxKind.PropertyAssignment)?.getInitializer();
  if (init?.getKind() === SyntaxKind.Identifier) {
    const decl = init.asKindOrThrow(SyntaxKind.Identifier).getSymbol()?.getValueDeclaration();
    if (decl) return decl.getText();
  }
  return schemaProp.getText();
}

export function findRoleInputHandlers(files: readonly SourceFile[]): RoleHandler[] {
  const out: RoleHandler[] = [];
  for (const sf of files) {
    if (TEST_FILE.test(sf.getFilePath())) continue;
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (call.getExpression().getText() !== "defineWriteHandler") continue;
      const arg = call.getArguments()[0];
      if (!arg || arg.getKind() !== SyntaxKind.ObjectLiteralExpression) continue;
      const obj = arg.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
      const name = literalStringOf(obj.getProperty("name"));
      const schema = obj.getProperty("schema");
      if (!name || !schema) continue;
      // `role:`/`roles:` zod field anywhere in the schema expression.
      if (!/\broles?\s*:/.test(resolvedSchemaText(schema))) continue;
      out.push({
        name,
        file: sf.getFilePath(),
        line: call.getStartLineNumber(),
      });
    }
  }
  return out;
}

function reservedRoleTestTexts(files: readonly SourceFile[]): string[] {
  const out: string[] = [];
  for (const sf of files) {
    if (!TEST_FILE.test(sf.getFilePath())) continue;
    const text = sf.getFullText();
    if (RESERVED_ROLE_LITERALS.some((r) => text.includes(r))) out.push(text);
  }
  return out;
}

export function findUntestedRoleHandlers(files: readonly SourceFile[]): RoleHandler[] {
  const handlers = findRoleInputHandlers(files);
  const tests = reservedRoleTestTexts(files);
  return handlers.filter((h) => {
    const forms = nameForms(h.name);
    // Word boundary instead of a raw includes(): a raw substring match on
    // the short forms (e.g. "create" from "user:create") would match any
    // test file that happens to contain "createTestStack()"/
    // "createSourceFile()" AND "SystemAdmin" somewhere — not real coverage
    // of the combination. \b keeps the documented file-wide (not
    // block-wide) matching intent while still requiring the name as its
    // own word.
    return !tests.some((t) => forms.some((f) => mentionsAsWord(t, f)));
  });
}

type OverrideHandler = { file: string; line: number };

export function findOverrideHandlersMissingHelper(files: readonly SourceFile[]): OverrideHandler[] {
  const out: OverrideHandler[] = [];
  for (const sf of files) {
    if (TEST_FILE.test(sf.getFilePath())) continue;
    for (const pa of sf.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
      if (pa.getName() !== "tenantIdOverride") continue;
      if (pa.getInitializer()?.getText().startsWith("z.") !== true) continue;
      // Scope the check to the enclosing defineWriteHandler(...) call, not
      // the whole file — a file with two override handlers where only one
      // calls crossTenantOverrideDenied must still flag the other.
      const handlerCall = pa.getFirstAncestor(
        (a) =>
          a.getKind() === SyntaxKind.CallExpression &&
          a.asKindOrThrow(SyntaxKind.CallExpression).getExpression().getText() ===
            "defineWriteHandler",
      );
      const scopeText = handlerCall?.getText() ?? sf.getFullText();
      if (scopeText.includes("crossTenantOverrideDenied")) continue;
      out.push({ file: sf.getFilePath(), line: pa.getStartLineNumber() });
    }
  }
  return out;
}

// A session built for a JWT — either the auth-session result shape or a typed
// SessionUser literal.
const SESSION_MINT = /kind:\s*"auth-session"|:\s*SessionUser\s*=\s*\{/;
// Roles read from a tenant membership (DB projection / invitation), as opposed
// to globalRoles or a compile-time constant. The merge lands in a `mergedRoles`
// variable, so the source lives in the file body, not the `roles:` literal —
// hence a file-level check.
const MEMBERSHIP_SOURCE = /\b(?:membership\.roles|chosen\.roles|invitationRole)\b/;
// A bare mention instead of a call test (`STRIP_FN + "("`) is deliberate
// here, not sloppy: the real login.write.ts handler doesn't call
// stripForbiddenMembershipRoles directly, but indirectly via
// buildSessionRoles() — a direct call test would false-positive there.
// This tolerates the false negative from the guard's own contract (dead
// imports/comments count too) but avoids the worse false positive against
// the real call path.
const STRIP_FN = "stripForbiddenMembershipRoles";

type MintSite = { file: string; line: number };

function lineOfMatch(text: string, re: RegExp): number {
  const m = re.exec(text);
  return m ? text.slice(0, m.index).split("\n").length : 1;
}

export function findMembershipMintsMissingStrip(files: readonly SourceFile[]): MintSite[] {
  const out: MintSite[] = [];
  for (const sf of files) {
    if (TEST_FILE.test(sf.getFilePath())) continue;
    const text = sf.getFullText();
    if (!SESSION_MINT.test(text)) continue;
    if (!MEMBERSHIP_SOURCE.test(text)) continue;
    if (text.includes(STRIP_FN)) continue;
    out.push({
      file: sf.getFilePath(),
      line: lineOfMatch(text, MEMBERSHIP_SOURCE),
    });
  }
  return out;
}

// The two halves of the cross-tenant gate lift-restriction.write.ts uses:
// SystemAdmin skips, everyone else needs an active membership row for the
// target in the caller's own tenant. Either token counts as "gated" — the
// combination is what the reviewer reads, a mention is what the guard can
// see without following the call graph.
const MEMBERSHIP_GATE = /\b(?:isSystemAdminActor|tenantMembershipsTable)\b/;
// A bare-mention match on `denyIfTargetOutsideAdminTenant` isn't enough — the
// helper returns `Promise<WriteFailure | undefined>` instead of throwing, so
// `await denyIfTargetOutsideAdminTenant(...)` with no binding has no gate at
// all despite passing a mention check. Require the return value to actually
// be consumed, matching the real lift-restriction.write.ts call form.
const CROSS_TENANT_HELPER_GATE = /(?:=|return)\s*await\s+denyIfTargetOutsideAdminTenant\s*\(/;
// `userId` in the payload means the handler targets an account other than the
// caller's own; a self-service handler reads event.user.id instead.
const TARGETS_OTHER_USER = /\buserId\s*:/;
// engine/config-helpers `access` presets whose roles are platform-wide actors
// (system / SystemAdmin) with no TenantAdmin in them. Deliberately does NOT
// exempt a bare SYSTEM_ROLE mention: `[SYSTEM_ROLE, "TenantAdmin"]` (the
// un-helpered access.withSystem form) is tenant-reachable, and no write
// handler needs the exemption today.
const PLATFORM_WIDE_ACCESS = /\baccess\.(?:systemAdmin|system|privileged)\b/;

type GlobalUserWrite = { name: string; file: string; line: number };

export function findGlobalUserWritesMissingMembershipCheck(
  files: readonly SourceFile[],
): GlobalUserWrite[] {
  const out: GlobalUserWrite[] = [];
  for (const sf of files) {
    if (TEST_FILE.test(sf.getFilePath())) continue;
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (call.getExpression().getText() !== "defineWriteHandler") continue;
      const arg = call.getArguments()[0];
      if (!arg || arg.getKind() !== SyntaxKind.ObjectLiteralExpression) continue;
      const obj = arg.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
      // `name` is only used for the violation message, not the security
      // check itself — a factory-built handler with a non-literal name
      // expression (`name: enable ? "enable" : "disable"`) must not skip
      // Check D just because literalStringOf() can't resolve it.
      const name = literalStringOf(obj.getProperty("name"));
      const schema = obj.getProperty("schema");
      const accessProp = obj.getProperty("access");
      // No `access` key at all = deny-all (engine/access.ts: undefined
      // returns false), so there is nothing to reach across a tenant.
      if (!schema || !accessProp) continue;
      // Presets that resolve to platform-wide actors only (engine/
      // config-helpers `access`): no tenant boundary exists to cross.
      // Everything else — access.admin, and the openToAll handlers that
      // gate on isAdminActor at runtime (#1556's shape) — is reachable by
      // a tenant-scoped TenantAdmin.
      if (PLATFORM_WIDE_ACCESS.test(accessProp.getText())) continue;
      if (!TARGETS_OTHER_USER.test(resolvedSchemaText(schema))) continue;
      const body = call.getText();
      // Must actually touch a *user* table — otherwise a handler reading
      // ctx.db.raw against an unrelated global table (plans, audit log,
      // invitations) gets flagged with a "reads a global user row" message
      // that doesn't apply to it (false-positive on clean code).
      if (!body.includes("ctx.db.raw") || !/\buserTable\b/.test(body)) continue;
      if (MEMBERSHIP_GATE.test(body) || CROSS_TENANT_HELPER_GATE.test(body)) continue;
      out.push({
        name: name ?? path.basename(sf.getFilePath()),
        file: sf.getFilePath(),
        line: call.getStartLineNumber(),
      });
    }
  }
  return out;
}

export const guard: AstGuard = {
  name: "Tenant-Escalation Guard",
  scan: SCAN,
  security: true,
  hint: "Role-input handlers need an escalation test (assert a reserved role is rejected); tenantIdOverride handlers must call crossTenantOverrideDenied; membership-derived JWT mints must call stripForbiddenMembershipRoles; TenantAdmin-reachable ctx.db.raw user writes must check the target's membership.",
  run(files) {
    const violations: Array<{ file: string; line: number; message: string }> = [];

    for (const h of findUntestedRoleHandlers(files)) {
      violations.push({
        file: path.relative(ROOT, h.file),
        line: h.line,
        message: `role-input write handler "${h.name}" has no escalation test — add a test asserting a reserved/global role (SystemAdmin/system/all/anonymous) is rejected.`,
      });
    }

    for (const o of findOverrideHandlersMissingHelper(files)) {
      violations.push({
        file: path.relative(ROOT, o.file),
        line: o.line,
        message:
          "handler exposes tenantIdOverride but never calls crossTenantOverrideDenied — route the SystemAdmin gate through the shared helper.",
      });
    }

    for (const m of findMembershipMintsMissingStrip(files)) {
      violations.push({
        file: path.relative(ROOT, m.file),
        line: m.line,
        message:
          "JWT mint derives session roles from a membership but never calls stripForbiddenMembershipRoles — a reserved role resurrected by a projection rebuild would reach the session. Strip the membership portion (see engine/membership-roles).",
      });
    }

    for (const g of findGlobalUserWritesMissingMembershipCheck(files)) {
      violations.push({
        file: path.relative(ROOT, g.file),
        line: g.line,
        message: `write handler "${g.name}" reads a global user row via ctx.db.raw and is reachable by a tenant-scoped admin, but never checks the target's membership in the caller's tenant — a TenantAdmin from another tenant could act on this account. Gate it like lift-restriction.write.ts (denyIfTargetOutsideAdminTenant, or isSystemAdminActor + tenantMembershipsTable lookup).`,
      });
    }

    return { violations };
  },
};

if (import.meta.main) runStandalone(guard);
