import { afterAll, beforeAll, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { TenantHandlers } from "../../tenant/web/constants.ts";
import {
  driveDestructionToCompletion,
  seedDestroyingTenant,
} from "../../tenant-lifecycle/testing.ts";
import { deviceTable } from "../schema/device.ts";
import { deviceAuthorizationTable } from "../schema/device-authorization.ts";
import {
  pairDevice,
  setupConnectorsStack,
  teardownConnectorsStack,
  tenantAdmin,
  upload,
} from "./connectors-stack.ts";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupConnectorsStack();
});
afterAll(() => teardownConnectorsStack(stack));

test("destroying a tenant removes its device and pairing rows and kills the old token", async () => {
  await stack.http.writeOk(
    TenantHandlers.create,
    { id: tenantAdmin.tenantId, key: "connectors-destroy", name: "Tenant" },
    TestUsers.systemAdmin,
  );
  await stack.http.writeOk(
    "compliance-profiles:write:set-profile",
    { profileKey: "eu-dsgvo" },
    tenantAdmin,
  );
  const { token } = await pairDevice(stack);
  const bytes = Uint8Array.from([1, 2, 3]);
  expect((await upload(stack, token, { path: "a/b.bin", bytes })).status).toBe(201);
  const owned = { ownerTenantId: tenantAdmin.tenantId };
  expect(await selectMany(stack.db, deviceTable, owned)).toHaveLength(1);

  await seedDestroyingTenant(stack, tenantAdmin.tenantId);
  expect(await driveDestructionToCompletion(stack, stack.db, tenantAdmin.tenantId)).toBe(
    "destroyed",
  );

  expect(await selectMany(stack.db, deviceTable, owned)).toHaveLength(0);
  expect(await selectMany(stack.db, deviceAuthorizationTable, owned)).toHaveLength(0);
  expect((await upload(stack, token, { path: "a/c.bin", bytes })).status).toBe(401);
});
