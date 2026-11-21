import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createSystemUser, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { createTenantDb } from "@cosmicdrift/kumiko-framework/internal/row-level-security";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { ConnectorHandlers, ConnectorQueries } from "../constants.ts";
import { hashDeviceSecret } from "../hash.ts";
import { connectorExecutor } from "../schema/connector.ts";
import { uploadConnectorFile } from "../testing.ts";
import {
  HEARTBEAT_PATH,
  listConnectors,
  pairDevice,
  setupConnectorsStack,
  teardownConnectorsStack,
  tenantAdmin,
} from "./connectors-stack.ts";

let stack: TestStack;
let token: string;
let connectorId: string;

const heartbeat = (body: unknown) =>
  stack.app.request(HEARTBEAT_PATH, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const row = async () => (await listConnectors(stack)).find((c) => c.id === connectorId);

beforeAll(async () => {
  stack = await setupConnectorsStack();
  ({ token, connectorId } = await pairDevice(stack));
});
afterAll(() => teardownConnectorsStack(stack));

describe("heartbeat sync report and retry signal", () => {
  test("an old satellite without sync still works and shows an unknown sync status", async () => {
    const res = await heartbeat({ version: "1.0.0" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, name: "Office server" });
    expect((await row())?.syncStatus).toBe("unknown");
  });

  test("a state or failure change is stored at once, inside the throttle window", async () => {
    const syncing = await heartbeat({
      version: "1.0.0",
      sync: { state: "syncing", queued: 12, failed: 0, lastError: "x".repeat(500) },
    });
    expect(syncing.status).toBe(200);
    expect((await row())?.syncStatus).toBe("syncing");
    expect((await row())?.syncDetail).toEqual({
      i18nKey: "connectors.list.sync.queued",
      i18nParams: { count: 12 },
    });

    await heartbeat({ version: "1.0.0", sync: { state: "idle", queued: 0, failed: 3 } });
    expect((await row())?.syncStatus).toBe("failed");
    expect((await row())?.syncDetail).toEqual({
      i18nKey: "connectors.list.sync.failedCount",
      i18nParams: { count: 3 },
    });
  });

  test("a malformed sync report is a 400", async () => {
    const res = await heartbeat({
      version: "1.0.0",
      sync: { state: "bogus", queued: -1, failed: 0 },
    });
    expect(res.status).toBe(400);
  });

  test("retry: the flag set by the admin action rides on exactly one heartbeat answer, an upload does not take it", async () => {
    await heartbeat({ version: "1.0.0", sync: { state: "idle", queued: 0, failed: 2 } });
    await stack.http.writeOk(ConnectorHandlers.requestRetry, { id: connectorId }, tenantAdmin);

    const sent = await uploadConnectorFile(stack, token, {
      path: "r/a.bin",
      bytes: Uint8Array.from([1]),
    });
    expect(sent.status).toBe(201);

    const first = await heartbeat({
      version: "1.0.0",
      sync: { state: "idle", queued: 0, failed: 2 },
    });
    expect(await first.json()).toEqual({ ok: true, retry: true, name: "Office server" });
    const second = await heartbeat({
      version: "1.0.0",
      sync: { state: "idle", queued: 0, failed: 2 },
    });
    expect(await second.json()).toEqual({ ok: true, name: "Office server" });
  });
});
describe("connector list names a full storage after an upload was refused", () => {
  test("a refused upload shows it, space and an accepted upload clear it", async () => {
    const small = await setupConnectorsStack({ maxStoredBytesPerTenant: 20 });
    try {
      const paired = await pairDevice(small);
      const send = (body: unknown) =>
        small.app.request(HEARTBEAT_PATH, {
          method: "POST",
          headers: { authorization: `Bearer ${paired.token}`, "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      const detail = async () =>
        (await listConnectors(small)).find((c) => c.id === paired.connectorId)?.syncDetail;

      const first = await uploadConnectorFile(small, paired.token, {
        path: "a/one.bin",
        bytes: new Uint8Array(12).fill(1),
      });
      expect(first.status).toBe(201);
      await send({ version: "1.0.0", sync: { state: "error", queued: 4, failed: 0 } });
      expect(await detail()).toBeNull();

      const refused = await uploadConnectorFile(small, paired.token, {
        path: "a/two.bin",
        bytes: new Uint8Array(12).fill(2),
      });
      expect(refused.status).toBe(507);
      expect(await detail()).toEqual({ i18nKey: "connectors.sync.detail.storageFull" });

      const { id } = (await first.json()) as { id: string };
      await small.http.writeOk(ConnectorHandlers.deleteFile, { id }, tenantAdmin);
      const accepted = await uploadConnectorFile(small, paired.token, {
        path: "a/two.bin",
        bytes: new Uint8Array(12).fill(2),
      });
      expect(accepted.status).toBe(201);
      expect(await detail()).toBeNull();
    } finally {
      await teardownConnectorsStack(small);
    }
  });
});

describe("the storage-full flag survives touches that arrive out of order", () => {
  async function withFullStorage(
    run: (ctx: {
      small: TestStack;
      deviceId: string;
      first: Response;
      token: string;
      detail: () => Promise<unknown>;
    }) => Promise<void>,
  ) {
    const small = await setupConnectorsStack({ maxStoredBytesPerTenant: 20 });
    try {
      const paired = await pairDevice(small);
      const resolved = (await small.dispatcher.query(
        ConnectorQueries.resolveDevice,
        { tokenHash: hashDeviceSecret(paired.token) },
        createSystemUser(SYSTEM_TENANT_ID),
      )) as { deviceId: string };
      const first = await uploadConnectorFile(small, paired.token, {
        path: "a/one.bin",
        bytes: new Uint8Array(12).fill(1),
      });
      expect(first.status).toBe(201);
      const refused = await uploadConnectorFile(small, paired.token, {
        path: "a/two.bin",
        bytes: new Uint8Array(12).fill(2),
      });
      expect(refused.status).toBe(507);
      await run({
        small,
        deviceId: resolved.deviceId,
        first,
        token: paired.token,
        detail: async () =>
          (await listConnectors(small)).find((c) => c.id === paired.connectorId)?.syncDetail,
      });
    } finally {
      await teardownConnectorsStack(small);
    }
  }

  const touch = (small: TestStack, deviceId: string, uploadDecidedAt: string) =>
    small.dispatcher.write(
      ConnectorHandlers.touchDevice,
      { deviceId, upload: "accepted", uploadDecidedAt },
      createSystemUser(SYSTEM_TENANT_ID),
    );

  test("the late touch of an earlier accepted upload does not clear a later refusal", async () => {
    await withFullStorage(async ({ small, deviceId, detail }) => {
      await touch(small, deviceId, "2000-01-01T00:00:00Z");
      expect(await detail()).toEqual({ i18nKey: "connectors.sync.detail.storageFull" });
      await touch(small, deviceId, "2999-01-01T00:00:00Z");
      expect(await detail()).toBeNull();
    });
  });

  test("a duplicate delivery of a stored file does not clear the flag", async () => {
    await withFullStorage(async ({ small, token, detail }) => {
      const again = await uploadConnectorFile(small, token, {
        path: "a/one.bin",
        bytes: new Uint8Array(12).fill(1),
      });
      expect(again.status).toBe(200);
      expect(await again.json()).toMatchObject({ duplicate: true });
      expect(await detail()).toEqual({ i18nKey: "connectors.sync.detail.storageFull" });
    });
  });
});

describe("heartbeat of a device whose connector row is gone", () => {
  test("answers without a name, and still carries the retry signal once", async () => {
    const gone = await setupConnectorsStack();
    try {
      const paired = await pairDevice(gone);
      const send = () =>
        gone.app.request(HEARTBEAT_PATH, {
          method: "POST",
          headers: { authorization: `Bearer ${paired.token}`, "content-type": "application/json" },
          body: JSON.stringify({ version: "1.0.0" }),
        });
      await gone.http.writeOk(
        ConnectorHandlers.requestRetry,
        { id: paired.connectorId },
        tenantAdmin,
      );

      const deleted = await connectorExecutor.delete(
        { id: paired.connectorId },
        createSystemUser(tenantAdmin.tenantId),
        createTenantDb({
          db: gone.db,
          tenantId: tenantAdmin.tenantId,
          mode: "system",
          reason: "test removes the connector row while its device stays authenticated",
        }),
        { streamTenantId: tenantAdmin.tenantId },
      );
      expect(deleted.isSuccess).toBe(true);

      const withRetry = await send();
      expect(withRetry.status).toBe(200);
      expect(await withRetry.json()).toEqual({ ok: true, retry: true });
      const plain = await send();
      expect(plain.status).toBe(200);
      expect(await plain.json()).toEqual({ ok: true });
    } finally {
      await teardownConnectorsStack(gone);
    }
  });
});
