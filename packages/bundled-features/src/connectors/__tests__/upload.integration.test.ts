import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  createInMemoryFileProvider,
  type InMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { ConnectorHandlers } from "../constants.ts";
import { inboundItemTable } from "../schema/inbound-item.ts";
import { uploadConnectorFile } from "../testing.ts";
import {
  FILES_PATH,
  HEARTBEAT_PATH,
  listConnectors,
  pairDevice,
  setupConnectorsStack,
  sha256Hex,
  teardownConnectorsStack,
  tenantAdmin,
} from "./connectors-stack.ts";

const MAX_UPLOAD = 4096;
// Not valid UTF-8: the route must hand the bytes through untouched.
const BINARY = Uint8Array.from([0xff, 0xfe, 0x80, 0x00, 0x41, 0xc3, 0x28]);

const provider = createInMemoryFileProvider();
let stack: TestStack;
let token: string;
let connectorId: string;

type UploadAnswer = { id: string; duplicate: boolean };

const itemCount = async () => (await selectMany(stack.db, inboundItemTable, {})).length;

beforeAll(async () => {
  stack = await setupConnectorsStack({ maxUploadBytes: MAX_UPLOAD }, undefined, provider);
  ({ token, connectorId } = await pairDevice(stack));
});
afterAll(() => teardownConnectorsStack(stack));

describe("connectors upload and heartbeat", () => {
  test("a request without a valid device token is 401 and creates nothing", async () => {
    const files = { path: "a/none.bin", bytes: BINARY };
    for (const bad of [null, `ksat_${"x".repeat(40)}`, "not-a-device-token"]) {
      const res = await uploadConnectorFile(stack, bad, files);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "invalid_token" });
    }
    const unknown = await uploadConnectorFile(stack, `ksat_${"x".repeat(40)}`, files);
    expect(unknown.headers.get("www-authenticate")).toBe("Bearer");
    expect(await itemCount()).toBe(0);
  });

  test("a delivered file becomes an inbound item; the same file again is the same item", async () => {
    const first = await uploadConnectorFile(stack, token, {
      path: "invoices\\2026\\a.bin",
      bytes: BINARY,
    });
    expect(first.status).toBe(201);
    const created = (await first.json()) as UploadAnswer;
    expect(created.duplicate).toBe(false);

    const again = await uploadConnectorFile(stack, token, {
      path: "invoices/2026/a.bin",
      bytes: BINARY,
    });
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

  test("a file delivered again after its deletion answers with the id of the new item", async () => {
    const bytes = Uint8Array.from([9, 8, 7, 6]);
    const first = (await (
      await uploadConnectorFile(stack, token, { path: "redo/x.bin", bytes })
    ).json()) as UploadAnswer;
    await stack.http.writeOk(ConnectorHandlers.deleteFile, { id: first.id }, tenantAdmin);

    const second = await uploadConnectorFile(stack, token, { path: "redo/x.bin", bytes });
    expect(second.status).toBe(201);
    const revived = (await second.json()) as UploadAnswer;
    expect(revived.id).not.toBe(first.id);

    const third = await uploadConnectorFile(stack, token, { path: "redo/x.bin", bytes });
    expect(third.status).toBe(200);
    expect(await third.json()).toEqual({ id: revived.id, duplicate: true });
  });

  test("the same bytes under another path are a new item", async () => {
    const before = await itemCount();
    const res = await uploadConnectorFile(stack, token, {
      path: "invoices/2026/copy.bin",
      bytes: BINARY,
    });
    expect(res.status).toBe(201);
    expect(await itemCount()).toBe(before + 1);
  });

  test("parallel deliveries of one file yield one item", async () => {
    const bytes = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const before = await itemCount();
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        uploadConnectorFile(stack, token, { path: "race/one.bin", bytes }),
      ),
    );
    const answers = await Promise.all(responses.map((res) => res.json() as Promise<UploadAnswer>));
    expect(responses.every((res) => res.status === 200 || res.status === 201)).toBe(true);
    expect(new Set(answers.map((answer) => answer.id)).size).toBe(1);
    expect(await itemCount()).toBe(before + 1);
  });

  test("bad input is rejected before anything is stored", async () => {
    const before = await itemCount();
    const mismatch = await uploadConnectorFile(stack, token, {
      path: "x/bad.bin",
      bytes: BINARY,
      sha256: sha256Hex(Uint8Array.from([9])),
    });
    expect(mismatch.status).toBe(400);
    for (const path of ["../escape.bin", "/abs/file.bin", "C:\\drive.bin", "a/../../b.bin"]) {
      expect((await uploadConnectorFile(stack, token, { path, bytes: BINARY })).status).toBe(400);
    }
    const badTime = await uploadConnectorFile(stack, token, {
      path: "x/time.bin",
      bytes: BINARY,
      mtime: "yesterday",
    });
    expect(badTime.status).toBe(400);
    const tooBig = await uploadConnectorFile(stack, token, {
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

  test("a heartbeat with a new version inside the throttle window still updates the version", async () => {
    const sent = await uploadConnectorFile(stack, token, {
      path: "x/fresh.bin",
      bytes: Uint8Array.from([7]),
    });
    expect(sent.status).toBe(201);
    const heartbeat = await stack.app.request(HEARTBEAT_PATH, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ version: "1.5.0" }),
    });
    expect(heartbeat.status).toBe(200);
    const connector = (await listConnectors(stack)).find((c) => c.id === connectorId);
    expect(connector?.reportedVersion).toBe("1.5.0");
  });

  test("revoking the connector stops the token at once", async () => {
    await stack.http.writeOk(ConnectorHandlers.revoke, { id: connectorId }, tenantAdmin);
    const res = await uploadConnectorFile(stack, token, {
      path: "after/revoke.bin",
      bytes: BINARY,
    });
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

describe("connectors upload rules", () => {
  let freshToken: string;
  beforeAll(async () => {
    ({ token: freshToken } = await pairDevice(stack, "Rules"));
  });

  test("system and lock files are refused with path_rejected and create nothing", async () => {
    const before = await itemCount();
    for (const path of ["Rechnungen/Thumbs.db", "$RECYCLE.BIN/x.pdf", "Büro/~$Angebot.docx"]) {
      const res = await uploadConnectorFile(stack, freshToken, { path, bytes: BINARY });
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ error: "path_rejected" });
    }
    expect(await itemCount()).toBe(before);
  });

  test("a stored file lives under the nobackup prefix of its tenant", async () => {
    const res = await uploadConnectorFile(stack, freshToken, {
      path: "Lieferscheine/LS-0001.bin",
      bytes: BINARY,
    });
    expect(res.status).toBe(201);
    const keys = await provider.list("");
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((key) => key.startsWith(`nobackup/${tenantAdmin.tenantId}/`))).toBe(true);
  });
});

describe("connectors storage quota", () => {
  test("an upload beyond the tenant quota stores nothing and answers 507", async () => {
    const quotaProvider = createInMemoryFileProvider();
    const small = await setupConnectorsStack(
      { maxStoredBytesPerTenant: 10 },
      undefined,
      quotaProvider,
    );
    try {
      const { token: smallToken } = await pairDevice(small);
      const fits = await uploadConnectorFile(small, smallToken, {
        path: "a/one.bin",
        bytes: new Uint8Array(6),
      });
      expect(fits.status).toBe(201);

      const over = await uploadConnectorFile(small, smallToken, {
        path: "a/two.bin",
        bytes: new Uint8Array(5),
      });
      expect(over.status).toBe(507);
      expect(await over.json()).toEqual({ error: "storage_quota_exceeded" });
      expect(await selectMany(small.db, inboundItemTable, {})).toHaveLength(1);
      expect(await quotaProvider.list("")).toHaveLength(1);

      const again = await uploadConnectorFile(small, smallToken, {
        path: "a/one.bin",
        bytes: new Uint8Array(6),
      });
      expect(again.status).toBe(200);
    } finally {
      await teardownConnectorsStack(small);
    }
  });

  test("an upload accepted late does not clear the refusal of an upload that began after it", async () => {
    const inner = createInMemoryFileProvider();
    let armed = false;
    let reachedWrite: () => void = () => {};
    let releaseWrite: () => void = () => {};
    const writeReached = new Promise<void>((resolve) => {
      reachedWrite = resolve;
    });
    const writeReleased = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    // Holds the first armed byte write, so upload A is decided only after upload B was refused.
    const gate = async () => {
      if (!armed) return;
      armed = false;
      reachedWrite();
      await writeReleased;
    };
    const gated: InMemoryFileProvider = {
      ...inner,
      async write(...args) {
        await gate();
        return inner.write(...args);
      },
      async writeStream(...args) {
        await gate();
        return inner.writeStream(...args);
      },
    };
    const small = await setupConnectorsStack({ maxStoredBytesPerTenant: 10 }, undefined, gated);
    try {
      const { token: smallToken, connectorId: smallConnectorId } = await pairDevice(small);
      const detail = async () =>
        (await listConnectors(small)).find((c) => c.id === smallConnectorId)?.syncDetail;
      const filler = await uploadConnectorFile(small, smallToken, {
        path: "a/filler.bin",
        bytes: new Uint8Array(6),
      });
      expect(filler.status).toBe(201);

      armed = true;
      const slowAccepted = uploadConnectorFile(small, smallToken, {
        path: "a/slow.bin",
        bytes: new Uint8Array(3),
      });
      await writeReached;
      const laterRefused = await uploadConnectorFile(small, smallToken, {
        path: "a/refused.bin",
        bytes: new Uint8Array(5),
      });
      expect(laterRefused.status).toBe(507);
      expect(await detail()).toEqual({ i18nKey: "connectors.sync.detail.storageFull" });

      releaseWrite();
      expect((await slowAccepted).status).toBe(201);
      expect(await detail()).toEqual({ i18nKey: "connectors.sync.detail.storageFull" });
    } finally {
      await teardownConnectorsStack(small);
    }
  });
});
