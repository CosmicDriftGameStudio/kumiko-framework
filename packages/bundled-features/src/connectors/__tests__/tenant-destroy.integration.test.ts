import { afterAll, beforeAll, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { createInMemoryFileProvider } from "@cosmicdrift/kumiko-framework/files";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { tenantTable } from "../../tenant/schema/tenant.ts";
import { TenantHandlers } from "../../tenant/web/constants.ts";
import { runTenantDestructionSweep, seedDestroyingTenant } from "../../tenant-lifecycle/testing.ts";
import { deviceTable } from "../schema/device.ts";
import { deviceAuthorizationTable } from "../schema/device-authorization.ts";
import { inboundFolderTable } from "../schema/inbound-folder.ts";
import { inboundItemTable } from "../schema/inbound-item.ts";
import { uploadConnectorFile } from "../testing.ts";
import {
  pairDevice,
  setupConnectorsStack,
  teardownConnectorsStack,
  tenantAdmin,
} from "./connectors-stack.ts";

const provider = createInMemoryFileProvider();
let stack: TestStack;

beforeAll(async () => {
  stack = await setupConnectorsStack({}, undefined, provider);
});
afterAll(() => teardownConnectorsStack(stack));

async function driveDestruction(): Promise<string> {
  const farFuture = getTemporal()
    .Now.instant()
    .add({ hours: 24 * 3650 });
  let status = "";
  for (let i = 0; i < 20; i++) {
    await runTenantDestructionSweep({
      db: stack.db,
      registry: stack.registry,
      now: farFuture,
      fileProviderResolver: async () => provider,
    });
    const [row] = await selectMany(stack.db, tenantTable, { id: tenantAdmin.tenantId });
    status = String(row?.["status"]);
    if (status === "destroyed" || status === "destroyFailed" || status === "destroyHeld") break;
  }
  return status;
}

test("destroying a tenant removes its device, pairing and file rows, the stored bytes, and kills the old token", async () => {
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
  expect((await uploadConnectorFile(stack, token, { path: "a/b.bin", bytes })).status).toBe(201);
  const owned = { ownerTenantId: tenantAdmin.tenantId };
  expect(await selectMany(stack.db, deviceTable, owned)).toHaveLength(1);
  expect(await selectMany(stack.db, inboundItemTable, {})).toHaveLength(1);
  expect(await selectMany(stack.db, inboundFolderTable, {})).toHaveLength(1);
  const storedKeys = await provider.list("");
  expect(storedKeys).toHaveLength(1);
  expect(storedKeys[0]).toStartWith(`nobackup/${tenantAdmin.tenantId}/`);

  await seedDestroyingTenant(stack, tenantAdmin.tenantId);
  expect(await driveDestruction()).toBe("destroyed");

  expect(await selectMany(stack.db, deviceTable, owned)).toHaveLength(0);
  expect(await selectMany(stack.db, inboundItemTable, {})).toHaveLength(0);
  expect(await selectMany(stack.db, inboundFolderTable, {})).toHaveLength(0);
  expect(await provider.list("")).toHaveLength(0);
  expect(await selectMany(stack.db, deviceAuthorizationTable, owned)).toHaveLength(0);
  expect((await uploadConnectorFile(stack, token, { path: "a/c.bin", bytes })).status).toBe(401);
});
