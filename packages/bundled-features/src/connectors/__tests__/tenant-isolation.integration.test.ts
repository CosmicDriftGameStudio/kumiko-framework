import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { ConnectorHandlers, ConnectorQueries } from "../constants.ts";
import { uploadConnectorFile } from "../testing.ts";
import {
  checkCode,
  HEARTBEAT_PATH,
  pollToken,
  setupConnectorsStack,
  startPairing,
  teardownConnectorsStack,
} from "./connectors-stack.ts";

const adminA = createTestUser({ id: 11, tenantId: testTenantId(1), roles: ["TenantAdmin"] });
const adminB = createTestUser({ id: 12, tenantId: testTenantId(2), roles: ["TenantAdmin"] });

type Row = { id: string; name: string; reportedVersion: string | null; lastSeenAt: string | null };

let stack: TestStack;
let tokenA: string;
let connectorA: string;

const listAs = async (user: typeof adminA) =>
  (await stack.http.queryOk<{ rows: Row[] }>(ConnectorQueries.list, {}, user)).rows;

beforeAll(async () => {
  stack = await setupConnectorsStack();
  const started = await startPairing(stack);
  await checkCode(stack, started.user_code, adminA);
  const approved = await stack.http.writeOk<{ connectorId: string }>(
    ConnectorHandlers.approveDevice,
    { userCode: started.user_code, name: "Tenant A server" },
    adminA,
  );
  connectorA = approved.connectorId;
  tokenA = (
    (await (await pollToken(stack, started.device_code)).json()) as { access_token: string }
  ).access_token;
  await stack.app.request(HEARTBEAT_PATH, {
    method: "POST",
    headers: { authorization: `Bearer ${tokenA}`, "content-type": "application/json" },
    body: JSON.stringify({ version: "9.9.9" }),
  });
});

afterAll(() => teardownConnectorsStack(stack));

describe("connectors across tenants", () => {
  test("tenant B sees nothing of tenant A, including last-seen and version", async () => {
    expect((await listAs(adminA)).find((c) => c.id === connectorA)?.reportedVersion).toBe("9.9.9");
    expect(await listAs(adminB)).toEqual([]);
  });

  test("tenant B cannot revoke tenant A's connector, whose token keeps working", async () => {
    const res = await stack.http.write(ConnectorHandlers.revoke, { id: connectorA }, adminB);
    expect(res.status).toBeGreaterThanOrEqual(400);
    const sent = await uploadConnectorFile(stack, tokenA, {
      path: "a/file.bin",
      bytes: Uint8Array.from([1, 2]),
    });
    expect(sent.status).toBe(201);
  });

  test("a device paired by tenant B appears only for B", async () => {
    const started = await startPairing(stack);
    await checkCode(stack, started.user_code, adminB);
    const { connectorId } = await stack.http.writeOk<{ connectorId: string }>(
      ConnectorHandlers.approveDevice,
      { userCode: started.user_code, name: "Tenant B server" },
      adminB,
    );
    expect((await listAs(adminB)).map((c) => c.id)).toEqual([connectorId]);
    expect((await listAs(adminA)).map((c) => c.id)).not.toContain(connectorId);
  });
});
