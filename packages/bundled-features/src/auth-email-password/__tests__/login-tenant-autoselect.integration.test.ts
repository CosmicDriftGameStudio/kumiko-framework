// Login must not auto-select a disabled tenant and accepts only argon2id password hashes.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { createTestEnvelopeCipher, resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { hashPassword } from "../../shared/password-hashing.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { createTenantFeature, TenantHandlers } from "../../tenant/index.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { seedTenantMembership } from "../../tenant/testing.ts";
import { createUserFeature } from "../../user/feature.ts";
import { UserHandlers } from "../../user/index.ts";
import { userEntity, userTable } from "../../user/schema/user.ts";
import { createAuthEmailPasswordFeature } from "../feature.ts";
import { AuthErrors, AuthHandlers } from "../web/constants.ts";

let stack: TestStack;

const systemAdmin = TestUsers.systemAdmin;
const encryptionKey = randomBytes(32).toString("base64");

// Builds an ASP.NET Core Identity V3 hash (HMACSHA256, 10000 iterations).
function buildIdentityV3Hash(password: string, salt: Buffer): string {
  const subkey = pbkdf2Sync(password, salt, 10_000, 32, "sha256");
  const header = Buffer.alloc(13);
  header.writeUInt8(0x01, 0); // V3 format marker
  header.writeUInt32BE(1, 1); // PRF = HMACSHA256
  header.writeUInt32BE(10_000, 5); // iterations
  header.writeUInt32BE(salt.length, 9); // salt length
  return Buffer.concat([header, salt, subkey]).toString("base64");
}

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(encryptionKey);
  const resolver = createConfigResolver({ cipher: encryption });

  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createAuthEmailPasswordFeature(),
    ],
    extraContext: { configResolver: resolver, configEncryption: encryption },
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      loginErrorStatusMap: {
        [AuthErrors.invalidCredentials]: 401,
        [AuthErrors.noMembership]: 403,
      },
    },
  });

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [userTable, tenantMembershipsTable, eventsTable]);
});

// Disabled tenants must not appear in the login tenant selection: the
// auto-select (chosen = preferred ?? memberships[0]) must never choose a
// disabled tenant. The disabled tenant is deliberately the FIRST membership,
// making it the memberships[0] candidate.
describe("login auto-select skips disabled tenants", () => {
  test("first membership disabled → login lands on the active tenant", async () => {
    const password = "Active!Tenant-2026";

    const disabledTenantId = "00000000-0000-4000-8000-000000000301" as TenantId;
    const activeTenantId = "00000000-0000-4000-8000-000000000302" as TenantId;
    await stack.http.writeOk(
      TenantHandlers.create,
      { id: disabledTenantId, key: "ghost", name: "Ghost Corp" },
      systemAdmin,
    );
    await stack.http.writeOk(
      TenantHandlers.create,
      { id: activeTenantId, key: "alive", name: "Alive Corp" },
      systemAdmin,
    );
    await stack.http.writeOk(TenantHandlers.disable, { id: disabledTenantId }, systemAdmin);

    const created = await stack.http.writeOk<{ id: string }>(
      UserHandlers.create,
      {
        email: "carol@autoselect.example",
        passwordHash: await hashPassword(password),
        displayName: "Carol Two-Tenants",
      },
      systemAdmin,
    );
    await seedTenantMembership(stack.db, {
      userId: created.id,
      tenantId: disabledTenantId,
      roles: ["User"],
    });
    await seedTenantMembership(stack.db, {
      userId: created.id,
      tenantId: activeTenantId,
      roles: ["User"],
    });

    const res = await stack.http.raw("POST", "/api/auth/login", {
      email: "carol@autoselect.example",
      password,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toMatchObject({ id: created.id, tenantId: activeTenantId });
  });
});

describe("foreign hash formats", () => {
  test("a stored ASP.NET Identity V3 hash does not log in", async () => {
    const password = "Migrated!Password-2025";
    const tenantId = "00000000-0000-4000-8000-000000000099" as TenantId;
    const created = await stack.http.writeOk<{ id: string }>(
      UserHandlers.create,
      {
        email: "alice@legacy.example",
        passwordHash: buildIdentityV3Hash(password, randomBytes(16)),
        displayName: "Alice Migrated",
      },
      systemAdmin,
    );
    await seedTenantMembership(stack.db, {
      userId: created.id,
      tenantId,
      roles: ["User"],
    });

    const res = await stack.http.raw("POST", "/api/auth/login", {
      email: "alice@legacy.example",
      password,
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error?.details?.reason).toBe(AuthErrors.invalidCredentials);
  });
});
