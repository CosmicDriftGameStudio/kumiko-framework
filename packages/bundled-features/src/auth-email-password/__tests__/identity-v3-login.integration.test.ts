// End-to-end: ein migrierter User mit ASP.NET-Identity-V3-passwordHash kann
// sich über den normalen `auth-email-password.login`-Handler einloggen, ohne
// vorher Password-Reset durchlaufen zu müssen.
//
// Das ist der Kern-Use-Case der BMC-Migration — Legacy-Hashes 1:1
// übernommen, Login funktioniert weiter.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEncryptionProvider } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createTenantFeature } from "../../tenant";
import { tenantMembershipsTable } from "../../tenant/membership-table";
import { tenantEntity } from "../../tenant/schema/tenant";
import { seedTenantMembership } from "../../tenant/testing";
import { UserHandlers } from "../../user";
import { createUserFeature } from "../../user/feature";
import { userEntity, userTable } from "../../user/schema/user";
import { AuthErrors, AuthHandlers } from "../constants";
import { createAuthEmailPasswordFeature } from "../feature";

let stack: TestStack;

const systemAdmin = TestUsers.systemAdmin;
const encryptionKey = randomBytes(32).toString("base64");

// Build a V3-format hash with the BMC profile (HMACSHA256, 10000 iter,
// 16-byte salt). Mirrors the encoding in identity-v3-hash.test.ts — kept
// inline so this integration test stands alone.
function buildBmcStyleV3Hash(password: string, salt: Buffer): string {
  const subkey = pbkdf2Sync(password, salt, 10_000, 32, "sha256");
  const header = Buffer.alloc(13);
  header.writeUInt8(0x01, 0); // V3 format marker
  header.writeUInt32BE(1, 1); // PRF = HMACSHA256
  header.writeUInt32BE(10_000, 5); // iterations
  header.writeUInt32BE(salt.length, 9); // salt length
  return Buffer.concat([header, salt, subkey]).toString("base64");
}

beforeAll(async () => {
  const encryption = createEncryptionProvider(encryptionKey);
  const resolver = createConfigResolver({ encryption });

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
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantMembershipsTable.tableName}"`);
});

describe("Identity-V3 password-hash compatibility", () => {
  test("legacy V3-hashed user can log in with the right password", async () => {
    const password = "Migrated!Password-2025";
    const salt = randomBytes(16);
    const v3Hash = buildBmcStyleV3Hash(password, salt);

    // Seed the migrated user with the legacy hash 1:1 — no rehash, no reset.
    const tenantId = "00000000-0000-4000-8000-000000000099" as TenantId;
    const created = await stack.http.writeOk<{ id: string }>(
      UserHandlers.create,
      {
        email: "alice@legacy.example",
        passwordHash: v3Hash,
        displayName: "Alice Migrated",
      },
      systemAdmin,
    );
    await seedTenantMembership(stack.db, {
      userId: created.id,
      tenantId,
      roles: ["User"],
    });

    // Login: same /api/auth/login route the BMC frontend will hit
    // post-migration. Public route — no JWT, no authenticated caller.
    const res = await stack.http.raw("POST", "/api/auth/login", {
      email: "alice@legacy.example",
      password,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isSuccess).toBe(true);
    expect(body.user).toMatchObject({ id: created.id, tenantId });
  });

  test("legacy V3-hashed user is rejected with the wrong password", async () => {
    const password = "right-password";
    const salt = randomBytes(16);
    const v3Hash = buildBmcStyleV3Hash(password, salt);

    const tenantId = "00000000-0000-4000-8000-000000000098" as TenantId;
    const created = await stack.http.writeOk<{ id: string }>(
      UserHandlers.create,
      {
        email: "bob@legacy.example",
        passwordHash: v3Hash,
        displayName: "Bob Migrated",
      },
      systemAdmin,
    );
    await seedTenantMembership(stack.db, {
      userId: created.id,
      tenantId,
      roles: ["User"],
    });

    const res = await stack.http.raw("POST", "/api/auth/login", {
      email: "bob@legacy.example",
      password: "wrong-password",
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error?.details?.reason).toBe(AuthErrors.invalidCredentials);
  });
});
