import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { ConnectorHandlers } from "../constants.ts";
import { inboundItemTable } from "../schema/inbound-item.ts";
import {
  FILES_PATH,
  HEARTBEAT_PATH,
  listConnectors,
  pairDevice,
  setupConnectorsStack,
  sha256Hex,
  teardownConnectorsStack,
  tenantAdmin,
  upload,
} from "./connectors-stack.ts";

const MAX_UPLOAD = 4096;
// Not valid UTF-8: the route must hand the bytes through untouched.
const BINARY = Uint8Array.from([0xff, 0xfe, 0x80, 0x00, 0x41, 0xc3, 0x28]);

let stack: TestStack;
let token: string;
let connectorId: string;

type UploadAnswer = { id: string; duplicate: boolean };

const itemCount = async () => (await selectMany(stack.db, inboundItemTable, {})).length;

beforeAll(async () => {
  stack = await setupConnectorsStack({ maxUploadBytes: MAX_UPLOAD });
  ({ token, connectorId } = await pairDevice(stack));
});
afterAll(() => teardownConnectorsStack(stack));

describe("connectors upload and heartbeat", () => {
  test("a request without a valid device token is 401 and creates nothing", async () => {
    const files = { path: "a/none.bin", bytes: BINARY };
    for (const bad of [null, `ksat_${"x".repeat(40)}`, "not-a-device-token"]) {
      const res = await upload(stack, bad, files);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "invalid_token" });
    }
    const unknown = await upload(stack, `ksat_${"x".repeat(40)}`, files);
    expect(unknown.headers.get("www-authenticate")).toBe("Bearer");
    expect(await itemCount()).toBe(0);
  });

  test("a delivered file becomes an inbound item; the same file again is the same item", async () => {
    const first = await upload(stack, token, { path: "invoices\\2026\\a.bin", bytes: BINARY });
    expect(first.status).toBe(201);
    const created = (await first.json()) as UploadAnswer;
    expect(created.duplicate).toBe(false);

    const again = await upload(stack, token, { path: "invoices/2026/a.bin", bytes: BINARY });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ id: created.id, duplicate: true });

    const items = await selectMany<{
      id: string;
      connectorId: string;
      sha256: string;
      sizeBytes: number;
      fileRefId: string;
    }>(stack.db, inboundItemTable, { id: created.id });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      connectorId,
      sha256: sha256Hex(BINARY),
      sizeBytes: BINARY.byteLength,
    });
    expect(items[0]?.fileRefId).toBeTruthy();
  });

  test("the same bytes under another path are a new item", async () => {
    const before = await itemCount();
    const res = await upload(stack, token, { path: "invoices/2026/copy.bin", bytes: BINARY });
    expect(res.status).toBe(201);
    expect(await itemCount()).toBe(before + 1);
  });

  test("parallel deliveries of one file yield one item", async () => {
    const bytes = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const before = await itemCount();
    const responses = await Promise.all(
      Array.from({ length: 4 }, () => upload(stack, token, { path: "race/one.bin", bytes })),
    );
    const answers = await Promise.all(responses.map((res) => res.json() as Promise<UploadAnswer>));
    expect(responses.every((res) => res.status === 200 || res.status === 201)).toBe(true);
    expect(new Set(answers.map((answer) => answer.id)).size).toBe(1);
    expect(await itemCount()).toBe(before + 1);
  });

  test("bad input is rejected before anything is stored", async () => {
    const before = await itemCount();
    const mismatch = await upload(stack, token, {
      path: "x/bad.bin",
      bytes: BINARY,
      sha256: sha256Hex(Uint8Array.from([9])),
    });
    expect(mismatch.status).toBe(400);
    for (const path of ["../escape.bin", "/abs/file.bin", "C:\\drive.bin", "a/../../b.bin"]) {
      expect((await upload(stack, token, { path, bytes: BINARY })).status).toBe(400);
    }
    const badTime = await upload(stack, token, {
      path: "x/time.bin",
      bytes: BINARY,
      mtime: "yesterday",
    });
    expect(badTime.status).toBe(400);
    const tooBig = await upload(stack, token, {
      path: "x/big.bin",
      bytes: new Uint8Array(MAX_UPLOAD + 1),
    });
    expect(tooBig.status).toBe(413);
    expect(await itemCount()).toBe(before);
  });

  test("a heartbeat records the version and the last-seen time", async () => {
    stack.clock?.advance({ minutes: 10 });
    const res = await stack.app.request(HEARTBEAT_PATH, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ version: "1.4.2" }),
    });
    expect(res.status).toBe(200);
    const connector = (await listConnectors(stack)).find((c) => c.id === connectorId);
    expect(connector?.reportedVersion).toBe("1.4.2");
    expect(connector?.lastSeenAt).toBe(stack.clock?.now().toString() ?? "unreachable");

    const noToken = await stack.app.request(HEARTBEAT_PATH, { method: "POST", body: "{}" });
    expect(noToken.status).toBe(401);
  });

  test("revoking the connector stops the token at once", async () => {
    await stack.http.writeOk(ConnectorHandlers.revoke, { id: connectorId }, tenantAdmin);
    const res = await upload(stack, token, { path: "after/revoke.bin", bytes: BINARY });
    expect(res.status).toBe(401);
    const heartbeat = await stack.app.request(HEARTBEAT_PATH, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ version: "1.4.2" }),
    });
    expect(heartbeat.status).toBe(401);
    expect((await listConnectors(stack)).find((c) => c.id === connectorId)?.status).toBe("revoked");
    expect(FILES_PATH).toBe("/connectors/v1/files");
  });
});
