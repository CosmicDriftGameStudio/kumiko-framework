// Shared fixtures for session-related integration tests. Centralises the
// seed/login/request helpers while keeping per-suite state (stack, tenantId)
// explicit in the call site.
//
// Usage:
//   const h = makeSessionHelpers(stack, TENANT);
//   await h.seedUser("x@example.com", "pw");
//   const { token, sid } = await h.login("x@example.com", "pw");
//   const res = await h.authedPost("/api/query", token, { type, payload });

import { expect } from "bun:test";
import type { SessionCreator } from "@cosmicdrift/kumiko-framework/api";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as jose from "jose";
import { hashPassword } from "../../shared/index.ts";
import { seedTenantMembership } from "../../tenant/seeding.ts";
import { setMembershipRolesViaEventStore } from "../../tenant/testing-event-store.ts";
import { TenantHandlers } from "../../tenant/web/constants.ts";
import { UserHandlers } from "../../user/index.ts";
import type { UserStatus } from "../../user/schema/user.ts";
import { updateUserViaEventStore } from "../../user/testing-event-store.ts";
import { withMintedSession } from "../testing.ts";

export type LoginResult = {
  readonly token: string;
  readonly sid: string;
};

// Return type is inferred from the factory so callers just use
// `ReturnType<typeof makeSessionHelpers>` — no separate type export to
// keep in sync with the implementation. Params are typed inline on each
// method so the inference is sharp.
// `sessionCreator` is only needed when the suite wires a real sessionChecker
// (auth-middleware then rejects the sidless systemAdmin bootstrap actor
// used by seedUser). Suites without a sessionChecker (e.g. PAT tests) can
// omit it.
export function makeSessionHelpers(
  stack: TestStack,
  tenantId: TenantId,
  sessionCreator?: SessionCreator,
) {
  const systemActor = async () =>
    sessionCreator
      ? await withMintedSession(sessionCreator, TestUsers.systemAdmin)
      : TestUsers.systemAdmin;

  return {
    async seedUser(
      email: string,
      password: string,
      opts?: { roles?: readonly string[] },
    ): Promise<{ userId: string }> {
      const hash = await hashPassword(password);
      const actor = await systemActor();
      const created = await stack.http.writeOk<{ id: string }>(
        UserHandlers.create,
        { email, passwordHash: hash, displayName: email.split("@")[0] ?? "u" },
        actor,
      );
      await seedTenantMembership(stack.db, {
        userId: created.id,
        tenantId,
        roles: opts?.roles ?? ["User"],
      });
      return { userId: created.id };
    },

    /** Real handler path; revokes every session of the target user. */
    async updateMemberRoles(userId: string, roles: readonly string[]): Promise<void> {
      await stack.http.writeOk(
        TenantHandlers.updateMemberRoles,
        { userId, tenantId, roles },
        await systemActor(),
      );
    },

    setUserStatus(userId: string, status: UserStatus): Promise<void> {
      return updateUserViaEventStore(stack.db, userId, { status });
    },

    /** Event-store write that, unlike updateMemberRoles, leaves live sessions untouched. */
    setMembershipRolesWithoutRevoke(
      userId: string,
      roles: readonly string[],
      targetTenantId: TenantId = tenantId,
    ): Promise<void> {
      return setMembershipRolesViaEventStore(stack.db, { userId, tenantId: targetTenantId, roles });
    },

    async login(email: string, password: string): Promise<LoginResult> {
      const res = await stack.http.raw("POST", "/api/auth/login", { email, password });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { token: string };
      const payload = jose.decodeJwt(body.token);
      const sid = payload.jti;
      if (typeof sid !== "string") {
        throw new Error("login did not emit a sid — is sessions wired?");
      }
      return { token: body.token, sid };
    },

    /** POST with `Authorization: Bearer ${token}`. Body is JSON-serialised. */
    authedPost(path: string, token: string, body?: unknown): Promise<Response> {
      return stack.http.raw("POST", path, body, { Authorization: `Bearer ${token}` });
    },
  };
}
