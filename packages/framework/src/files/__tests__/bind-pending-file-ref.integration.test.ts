// loadPendingFileRef / bindPendingFileRef as a custom write handler uses them: imported through
// the public package specifier, driven by real uploads over HTTP.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type BindPendingFileRefOutcome,
  bindPendingFileRef,
  loadPendingFileRef,
  type PendingFileRef,
} from "@cosmicdrift/kumiko-framework/files";
import {
  buildMultipartBody,
  patchFileInstanceofForBunTest,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { asRawClient, selectMany } from "../../db/query.ts";
import {
  createEntity,
  createFileField,
  createTextField,
  defineFeature,
} from "../../engine/index.ts";
import { ANONYMOUS_ROLE } from "../../engine/system-user.ts";
import { createTestUser, testTenantId } from "../../seeding/seed-users.ts";
import { createFilesFeature } from "../feature.ts";
import { fileRefsTable } from "../file-ref-table.ts";
import { createLocalProvider } from "../local-provider.ts";

const ENTITY = "dossier";
const FIELD = "scan";

const probePayload = z.object({
  fileRefId: z.string(),
  fieldName: z.string().default(FIELD),
  entityId: z.string().default(""),
});

const dossierEntity = createEntity({
  table: "bind_probe_dossiers",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture" }),
    [FIELD]: createFileField(),
    cover: createFileField(),
  },
});

const probeFeature = defineFeature("bind-probe", (r) => {
  r.entity({ name: ENTITY, ...dossierEntity });
  r.writeHandler({
    name: "load-pending",
    schema: probePayload,
    access: { roles: ["Admin"] },
    handler: async (event, ctx) => {
      const pending = await loadPendingFileRef({
        fileRefId: event.payload.fileRefId,
        entityName: ENTITY,
        fieldName: event.payload.fieldName,
        user: event.user,
        db: ctx.db,
      });
      return { isSuccess: true as const, data: { pending: pending ?? null } };
    },
  });
  r.writeHandler({
    name: "bind",
    schema: probePayload,
    access: { roles: ["Admin"] },
    handler: async (event, ctx) => {
      const outcome = await bindPendingFileRef({
        fileRefId: event.payload.fileRefId,
        entityName: ENTITY,
        fieldName: event.payload.fieldName,
        entityId: event.payload.entityId,
        user: event.user,
        db: ctx.db,
      });
      return { isSuccess: true as const, data: { outcome } };
    },
  });
  // The anonymous session keeps the uploader's id: only the role marks it as a visitor.
  r.writeHandler({
    name: "load-as-anonymous",
    schema: probePayload,
    access: { roles: ["Admin"] },
    handler: async (event, ctx) => {
      const pending = await loadPendingFileRef({
        fileRefId: event.payload.fileRefId,
        entityName: ENTITY,
        fieldName: event.payload.fieldName,
        user: { ...event.user, roles: [ANONYMOUS_ROLE] },
        db: ctx.db,
      });
      return { isSuccess: true as const, data: { pending: pending ?? null } };
    },
  });
  r.writeHandler({
    name: "bind-as-anonymous",
    schema: probePayload,
    access: { roles: ["Admin"] },
    handler: async (event, ctx) => {
      const outcome = await bindPendingFileRef({
        fileRefId: event.payload.fileRefId,
        entityName: ENTITY,
        fieldName: event.payload.fieldName,
        entityId: event.payload.entityId,
        user: { ...event.user, roles: [ANONYMOUS_ROLE] },
        db: ctx.db,
      });
      return { isSuccess: true as const, data: { outcome } };
    },
  });
});

const LOAD = "bind-probe:write:load-pending";
const BIND = "bind-probe:write:bind";
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 minimal");

let stack: TestStack;
let storagePath: string;

const tenant = testTenantId(1);
const owner = createTestUser({ id: 1, tenantId: tenant, roles: ["Admin"] });
const otherUser = createTestUser({ id: 2, tenantId: tenant, roles: ["Admin"] });
const otherTenantUser = createTestUser({ id: 3, tenantId: testTenantId(2), roles: ["Admin"] });

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  storagePath = await mkdtemp(join(tmpdir(), "kumiko-bind-pending-ref-"));
  stack = await setupTestStack({
    features: [createFilesFeature(), probeFeature],
    files: { storageProvider: createLocalProvider(storagePath) },
  });
  await unsafeCreateEntityTable(stack.db, dossierEntity, ENTITY);
});

afterAll(async () => {
  await stack.cleanup();
  await rm(storagePath, { recursive: true, force: true });
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`TRUNCATE file_refs RESTART IDENTITY CASCADE`);
});

async function upload(
  as: typeof owner,
  fields: { entityType?: string; fieldName?: string } = { entityType: ENTITY, fieldName: FIELD },
): Promise<string> {
  const token = await stack.jwt.sign(as);
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.append(key, value);
  fd.append("file", new File([Buffer.from(PDF_BYTES)], "doc.pdf", { type: "application/pdf" }));
  const { body, contentType } = await buildMultipartBody(fd);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function loadAs(as: typeof owner, fileRefId: string, fieldName = FIELD) {
  const { pending } = await stack.http.writeOk<{ pending: PendingFileRef | null }>(
    LOAD,
    { fileRefId, fieldName },
    as,
  );
  return pending;
}

async function bindAs(
  as: typeof owner,
  fileRefId: string,
  entityId: string,
  fieldName = FIELD,
): Promise<BindPendingFileRefOutcome> {
  const { outcome } = await stack.http.writeOk<{ outcome: BindPendingFileRefOutcome }>(
    BIND,
    { fileRefId, entityId, fieldName },
    as,
  );
  return outcome;
}

async function boundEntityId(fileRefId: string): Promise<unknown> {
  const [row] = await selectMany(stack.db, fileRefsTable, { id: fileRefId });
  return row?.["entityId"];
}

describe("loadPendingFileRef", () => {
  test("returns the technical fields of the caller's own pending upload", async () => {
    const fileRefId = await upload(owner);

    const pending = await loadAs(owner, fileRefId);

    expect(pending).toMatchObject({
      id: fileRefId,
      mimeType: "application/pdf",
      size: PDF_BYTES.byteLength,
    });
    expect(pending?.storageKey).toEqual(expect.any(String));
    expect(pending?.version).toEqual(expect.any(Number));
    expect(pending).not.toHaveProperty("fileName");
  });

  test("hides another user's upload, another tenant's upload and a foreign field", async () => {
    const fileRefId = await upload(owner);

    expect(await loadAs(otherUser, fileRefId)).toBeNull();
    expect(await loadAs(otherTenantUser, fileRefId)).toBeNull();
    expect(await loadAs(owner, fileRefId, "cover")).toBeNull();
  });

  test("returns nothing for an id that is not a UUID", async () => {
    expect(await loadAs(owner, "not-a-uuid")).toBeNull();
  });

  test("returns nothing once the file is bound", async () => {
    const fileRefId = await upload(owner);
    await bindAs(owner, fileRefId, crypto.randomUUID());

    expect(await loadAs(owner, fileRefId)).toBeNull();
  });
});

describe("bindPendingFileRef", () => {
  test("binds the caller's own pending upload to the record", async () => {
    const fileRefId = await upload(owner);
    const entityId = crypto.randomUUID();

    expect(await bindAs(owner, fileRefId, entityId)).toBe("bound");
    expect(await boundEntityId(fileRefId)).toBe(entityId);
  });

  test("leaves another user's upload alone", async () => {
    const fileRefId = await upload(owner);

    expect(await bindAs(otherUser, fileRefId, crypto.randomUUID())).toBe("not-pending");
    expect(await boundEntityId(fileRefId)).toBeNull();
  });

  test("does not rebind an already bound file", async () => {
    const fileRefId = await upload(owner);
    const first = crypto.randomUUID();
    await bindAs(owner, fileRefId, first);

    expect(await bindAs(owner, fileRefId, crypto.randomUUID())).toBe("not-pending");
    expect(await boundEntityId(fileRefId)).toBe(first);
  });

  test("does not bind a file prepared for another field", async () => {
    const fileRefId = await upload(owner, { entityType: ENTITY, fieldName: "cover" });

    expect(await bindAs(owner, fileRefId, crypto.randomUUID())).toBe("not-pending");
    expect(await boundEntityId(fileRefId)).toBeNull();
  });

  test("of two parallel binds exactly one wins and the file points at the winner", async () => {
    const fileRefId = await upload(owner);
    const entityIds = [crypto.randomUUID(), crypto.randomUUID()] as const;

    const outcomes = await Promise.all(entityIds.map((id) => bindAs(owner, fileRefId, id)));

    expect(outcomes.filter((outcome) => outcome === "bound")).toHaveLength(1);
    const loser = outcomes.find((outcome) => outcome !== "bound");
    expect(loser).toMatch(/^(not-pending|version-conflict)$/);
    const winnerIndex = outcomes.indexOf("bound");
    expect(await boundEntityId(fileRefId)).toBe(entityIds.at(winnerIndex));
  });
});

describe("anonymous sessions", () => {
  test("never own an upload, even when the session carries the uploader's id", async () => {
    const fileRefId = await upload(owner);
    const entityId = crypto.randomUUID();

    const { pending } = await stack.http.writeOk<{ pending: PendingFileRef | null }>(
      "bind-probe:write:load-as-anonymous",
      { fileRefId, fieldName: FIELD },
      owner,
    );
    const { outcome } = await stack.http.writeOk<{ outcome: BindPendingFileRefOutcome }>(
      "bind-probe:write:bind-as-anonymous",
      { fileRefId, fieldName: FIELD, entityId },
      owner,
    );

    expect(pending).toBeNull();
    expect(outcome).toBe("not-pending");
    expect(await boundEntityId(fileRefId)).toBeNull();
    expect(await loadAs(owner, fileRefId)).not.toBeNull();
  });
});
