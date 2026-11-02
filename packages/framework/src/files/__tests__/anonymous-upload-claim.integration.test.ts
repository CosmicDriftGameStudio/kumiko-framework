// Anonymous visitors share one user id, so ownership of a pending upload cannot rest on it: the
// upload response carries a handle with a claim, and only the claim binds the file to a record.
// Real HTTP via setupTestStack.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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
import { createEventStoreExecutor } from "../../db/event-store-executor.ts";
import { selectMany } from "../../db/query.ts";
import { buildEntityTable } from "../../db/table-builder.ts";
import {
  createEntity,
  createFileField,
  createFilesField,
  createSystemUser,
  defineFeature,
  SYSTEM_ROLE,
} from "../../engine/index.ts";
import { eventsTable } from "../../event-store/index.ts";
import { testTenantId } from "../../seeding/seed-users.ts";
import { createFilesFeature } from "../feature.ts";
import { fileRefsTable } from "../file-ref-table.ts";
import { createInMemoryFileProvider } from "../in-memory-provider.ts";

const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 anonymous claim probe");
const OTHER_CLAIM = "A".repeat(43);

const photoEntity = createEntity({
  table: "anonymous_claim_photos",
  fields: {
    shot: createFileField({ anonymousUpload: true, accept: ["pdf"] }),
    gallery: createFilesField({ anonymousUpload: true, accept: ["pdf"], maxCount: 3 }),
  },
});
const photoTable = buildEntityTable("photo", photoEntity);
const badgeEntity = createEntity({
  table: "anonymous_claim_badges",
  fields: { logo: createFileField({ accept: ["pdf"] }) },
});
const badgeTable = buildEntityTable("badge", badgeEntity);
const photoPayload = z.object({
  shot: z.string().optional(),
  gallery: z.array(z.string()).optional(),
});

const updatePayload = z.object({ id: z.string(), version: z.number(), changes: photoPayload });

const probeFeature = defineFeature("claimprobe", (r) => {
  r.entity({ name: "photo", ...photoEntity });
  r.writeHandler({
    name: "create-photo",
    schema: photoPayload,
    access: { roles: ["anonymous", SYSTEM_ROLE], personalData: "public-intake" },
    handler: (event, ctx) =>
      createEventStoreExecutor(photoTable, photoEntity, { entityName: "photo" }).create(
        event.payload,
        event.user,
        ctx.db,
      ),
  });
  r.entity({ name: "badge", ...badgeEntity });
  r.writeHandler({
    name: "create-badge",
    schema: z.object({ logo: z.string().optional() }),
    access: { roles: ["anonymous", SYSTEM_ROLE], personalData: "public-intake" },
    handler: (event, ctx) =>
      createEventStoreExecutor(badgeTable, badgeEntity, { entityName: "badge" }).create(
        event.payload,
        event.user,
        ctx.db,
      ),
  });
  r.writeHandler({
    name: "update-photo",
    schema: updatePayload,
    access: { roles: ["anonymous", SYSTEM_ROLE], personalData: "public-intake" },
    handler: (event, ctx) =>
      createEventStoreExecutor(photoTable, photoEntity, { entityName: "photo" }).update(
        event.payload,
        event.user,
        ctx.db,
      ),
  });
});

const systemWriterFeature = defineFeature("claimsys", (r) => {
  r.systemScope();
  r.writeHandler({
    name: "create-photo-as-system",
    schema: photoPayload,
    access: { roles: ["anonymous"], personalData: "public-intake" },
    handler: async (event, ctx) => {
      const written = await ctx.dispatch.writeAs(
        createSystemUser(event.user.tenantId),
        "claimprobe:write:create-photo",
        event.payload,
      );
      return written.isSuccess ? { isSuccess: true as const, data: {} } : written;
    },
  });
});

let stack: TestStack;

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  stack = await setupTestStack({
    features: [createFilesFeature(), probeFeature, systemWriterFeature],
    files: { storageProvider: createInMemoryFileProvider() },
    anonymousAccess: { defaultTenantId: testTenantId(1) },
  });
  await unsafeCreateEntityTable(stack.db, photoEntity, "photo");
  await unsafeCreateEntityTable(stack.db, badgeEntity, "badge");
});

afterAll(() => stack.cleanup());

type Upload = { readonly id: string; readonly handle: string };

async function anonymousUpload(fieldName: "shot" | "gallery" = "shot"): Promise<Upload> {
  const fd = new FormData();
  fd.append("entityType", "photo");
  fd.append("fieldName", fieldName);
  fd.append("file", new File([Buffer.from(PDF_BYTES)], "doc.pdf", { type: "application/pdf" }));
  const { body, contentType } = await buildMultipartBody(fd);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Upload;
}

async function write(type: string, payload: Record<string, unknown>) {
  const res = await stack.http.raw("POST", "/api/write", { type, payload });
  return { status: res.status, text: await res.text() };
}

describe("an anonymous visitor reading or deleting another visitor's upload", () => {
  test("gets 404 on download, meta, batch meta and delete", async () => {
    const { id } = await anonymousUpload();
    expect((await stack.app.request(`/api/files/${id}`)).status).toBe(404);
    expect((await stack.app.request(`/api/files/${id}/meta`)).status).toBe(404);
    expect((await stack.app.request(`/api/files/meta?ids=${id}`)).status).toBe(404);
    expect((await stack.app.request(`/api/files/${id}`, { method: "DELETE" })).status).toBe(404);
    const [row] = await selectMany(stack.db, fileRefsTable, { id });
    expect(row?.["isDeleted"]).toBe(false);
  });
});

describe("a save naming a pending anonymous upload", () => {
  test("is rejected when the writer neither owns it nor presents the claim", async () => {
    const { id } = await anonymousUpload();
    for (const type of ["claimprobe:write:create-photo", "claimsys:write:create-photo-as-system"]) {
      const saved = await write(type, { shot: id });
      expect(saved.text).toContain("invalid_element");
    }
    expect(await selectMany(stack.db, photoTable)).toHaveLength(0);
  });

  test("is rejected for a list field entry without the claim", async () => {
    const { id } = await anonymousUpload("gallery");
    const saved = await write("claimprobe:write:create-photo", { gallery: [id] });
    expect(saved.text).toContain("invalid_element");
  });

  test.each(["claimprobe:write:create-photo", "claimsys:write:create-photo-as-system"])(
    "binds with the right handle and stores only the bare id (%s)",
    async (type) => {
      const { id, handle } = await anonymousUpload();
      expect(handle.startsWith(`${id}.`)).toBe(true);
      const saved = await write(type, { shot: handle });
      expect(saved.status).toBe(200);
      expect(saved.text).not.toContain("invalid_element");

      const rows = await selectMany(stack.db, photoTable, { shot: id });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.["shot"]).toBe(id);

      const [fileRef] = await selectMany(stack.db, fileRefsTable, { id });
      expect(fileRef?.["entityId"]).toBe(String(rows[0]?.["id"]));

      const claim = handle.slice(id.length + 1);
      const serialized = (value: unknown) =>
        JSON.stringify(value, (_key, part) => (typeof part === "bigint" ? part.toString() : part));
      const events = await selectMany(stack.db, eventsTable, {});
      expect(serialized(events)).not.toContain(claim);
      expect(serialized(rows)).not.toContain(claim);
      expect(serialized(fileRef)).not.toContain(claim);
    },
  );

  test("binds a list entry given as a handle", async () => {
    const { id, handle } = await anonymousUpload("gallery");
    const saved = await write("claimprobe:write:create-photo", { gallery: [handle] });
    expect(saved.status).toBe(200);
    const rows = await selectMany(stack.db, photoTable, {});
    expect(rows.some((row) => JSON.stringify(row["gallery"]) === JSON.stringify([id]))).toBe(true);
  });

  test("is rejected with a wrong claim, same error as no claim", async () => {
    const { id } = await anonymousUpload();
    const saved = await write("claimprobe:write:create-photo", { shot: `${id}.${OTHER_CLAIM}` });
    expect(saved.text).toContain("invalid_element");
    const [fileRef] = await selectMany(stack.db, fileRefsTable, { id });
    expect(fileRef?.["entityId"]).toBeNull();
  });

  test("a second save with the same handle loses once the first has bound the file", async () => {
    const { handle } = await anonymousUpload();
    const first = await write("claimprobe:write:create-photo", { shot: handle });
    expect(first.status).toBe(200);
    const second = await write("claimprobe:write:create-photo", { shot: handle });
    expect(second.text).toContain("invalid_element");
  });

  test("an update that resends the handle after the create bound it succeeds; on another record it is rejected", async () => {
    const { id, handle } = await anonymousUpload();
    const created = await write("claimprobe:write:create-photo", { shot: handle });
    expect(created.status).toBe(200);
    const [own] = await selectMany(stack.db, photoTable, { shot: id });
    const resend = await write("claimprobe:write:update-photo", {
      id: String(own?.["id"]),
      version: Number(own?.["version"]),
      changes: { shot: handle },
    });
    expect(resend.status).toBe(200);
    expect(resend.text).not.toContain("invalid_element");

    const second = await anonymousUpload();
    expect((await write("claimprobe:write:create-photo", { shot: second.handle })).status).toBe(
      200,
    );
    const [foreign] = await selectMany(stack.db, photoTable, { shot: second.id });
    const stolen = await write("claimprobe:write:update-photo", {
      id: String(foreign?.["id"]),
      version: Number(foreign?.["version"]),
      changes: { shot: handle },
    });
    expect(stolen.text).toContain("invalid_element");
  });

  test.each([
    ["another field of the same entity", "claimprobe:write:create-photo", "gallery"],
    ["a field of another entity", "claimprobe:write:create-badge", "logo"],
  ])(
    "a handle issued for photo.shot is rejected in %s and stays usable only for its own field",
    async (_label, type, target) => {
      const { id, handle } = await anonymousUpload("shot");
      const misused = await write(type, { [target]: target === "gallery" ? [handle] : handle });
      expect(misused.text).toContain("invalid_element");
      expect(await selectMany(stack.db, badgeTable, {})).toHaveLength(0);

      const [stillPending] = await selectMany(stack.db, fileRefsTable, { id });
      expect(stillPending?.["entityId"]).toBeNull();
      expect(typeof stillPending?.["claimHash"]).toBe("string");

      const intended = await write("claimprobe:write:create-photo", { shot: handle });
      expect(intended.status).toBe(200);
    },
  );
});
