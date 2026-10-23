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
import {
  createEventStoreExecutor,
  createTenantDb,
  type DbConnection,
  fetchOne,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as jose from "jose";
import { hashPassword } from "../../shared/index.ts";
import { tenantMembershipEntity, tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { seedTenantMembership } from "../../tenant/seeding.ts";
import { TenantHandlers } from "../../tenant/web/constants.ts";
import { UserHandlers } from "../../user/index.ts";
import { type UserStatus, userEntity, userTable } from "../../user/schema/user.ts";
import { withMintedSession } from "../testing.ts";

const userExecutor = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });
const membershipExecutor = createEventStoreExecutor(
  tenantMembershipsTable,
  tenantMembershipEntity,
  {
    entityName: "tenant-membership",
  },
);

function numericVersionOf(row: Record<string, unknown>, what: string): number {
  const version = row["version"];
  if (typeof version !== "number") throw new Error(`${what}: row has no numeric version`);
  return version;
}

function stringIdOf(row: Record<string, unknown>, what: string): string {
  const id = row["id"];
  if (typeof id !== "string") throw new Error(`${what}: row has no string id`);
  return id;
}

async function setUserStatusViaExecutor(
  db: DbConnection,
  userId: string,
  status: UserStatus,
): Promise<void> {
  const row = await fetchOne(db, userTable, { id: userId });
  if (!row) throw new Error(`setUserStatus: user ${userId} not found`);
  const result = await userExecutor.update(
    { id: userId, version: numericVersionOf(row, "setUserStatus"), changes: { status } },
    createSystemUser(SYSTEM_TENANT_ID),
    createTenantDb({ db, tenantId: SYSTEM_TENANT_ID, mode: "system" }),
  );
  if (!result.isSuccess) {
    throw new Error(`setUserStatus failed: ${result.error.code}`);
  }
}

async function setMembershipRolesViaExecutor(
  db: DbConnection,
  userId: string,
  tenantId: TenantId,
  roles: readonly string[],
): Promise<void> {
  const row = await fetchOne(db, tenantMembershipsTable, { userId, tenantId });
  if (!row) throw new Error(`setMembershipRolesWithoutRevoke: no membership for ${userId}`);
  const result = await membershipExecutor.update(
    {
      id: stringIdOf(row, "setMembershipRolesWithoutRevoke"),
      version: numericVersionOf(row, "setMembershipRolesWithoutRevoke"),
      changes: { roles: JSON.stringify(roles) },
    },
    createSystemUser(tenantId),
    createTenantDb({ db, tenantId, mode: "system" }),
    { streamTenantId: tenantId },
  );
  if (!result.isSuccess) {
    throw new Error(`setMembershipRolesWithoutRevoke failed: ${result.error.code}`);
  }
}

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
      return setUserStatusViaExecutor(stack.db, userId, status);
    },

    /** Event-store write that, unlike updateMemberRoles, leaves live sessions untouched. */
    setMembershipRolesWithoutRevoke(
      userId: string,
      roles: readonly string[],
      targetTenantId: TenantId = tenantId,
    ): Promise<void> {
      return setMembershipRolesViaExecutor(stack.db, userId, targetTenantId, roles);
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
