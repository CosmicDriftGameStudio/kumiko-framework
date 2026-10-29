// A probe app for rebindFileRef: a file is uploaded and bound to an upload (or inbox) record over
// HTTP, then a custom handler or a system job moves it onto a contact.

import { expect } from "bun:test";
import { type RebindFileRefOutcome, rebindFileRef } from "@cosmicdrift/kumiko-framework/files";
import {
  buildMultipartBody,
  createBarrier,
  patchFileInstanceofForBunTest,
} from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { selectMany } from "../../db/query.ts";
import {
  createBooleanField,
  createEntity,
  createFileField,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDeleteHandler,
  defineEntityDetailHandler,
  defineEntityUpdateHandler,
  defineFeature,
  HookPhases,
} from "../../engine/index.ts";
import { createTestUser, testTenantId } from "../../seeding/seed-users.ts";
import { createFilesFeature } from "../feature.ts";
import { fileRefsTable } from "../file-ref-table.ts";
import { createInMemoryFileProvider } from "../in-memory-provider.ts";

const openToAll = { openToAll: { reason: "test handler callable by any signed-in test user" } };
const name = () =>
  createTextField({ required: true, maxLength: 64, personal: false, reason: "test" });

const uploadEntity = createEntity({
  table: "rebind_t_uploads",
  fields: {
    name: name(),
    file: createFileField(),
    isArchived: createBooleanField({ default: false }),
  },
  lockedWhen: { field: "isArchived", eq: true },
});
// A source like an inbound mail: no update handler, so only the system job may take its file.
const inboxEntity = createEntity({
  table: "rebind_t_inbox",
  fields: { name: name(), file: createFileField() },
});
const contactEntity = createEntity({
  table: "rebind_t_contacts",
  fields: {
    name: name(),
    doc: createFileField({ accept: ["pdf"] }),
    photo: createFileField({ accept: ["png"] }),
  },
});

export type SourceType = "upload" | "inbox";

const rebindPayload = z.object({
  fileRefId: z.string(),
  source: z.enum(["upload", "inbox"]).default("upload"),
  uploadId: z.string(),
  contactId: z.string(),
  fieldName: z.string().default("doc"),
});
export type RebindPayload = z.input<typeof rebindPayload>;

function ownersOf(payload: z.infer<typeof rebindPayload>) {
  return {
    fileRefId: payload.fileRefId,
    from: { entityType: payload.source, entityId: payload.uploadId, fieldName: "file" },
    to: { entityType: "contact", entityId: payload.contactId, fieldName: payload.fieldName },
  };
}

// Archiving an upload can be held inside its transaction, after the row is written and before
// the commit, so a rebind can run against the uncommitted lock.
let archiveWritten = createBarrier({ expected: 2 });
let archiveMayCommit = Promise.resolve();
let releaseArchive: () => void = () => {};
let holdArchive = false;

export function armArchiveHold(): {
  readonly written: () => Promise<void>;
  readonly commit: () => void;
} {
  holdArchive = true;
  archiveWritten = createBarrier({ expected: 2 });
  archiveMayCommit = new Promise<void>((resolve) => {
    releaseArchive = resolve;
  });
  return {
    written: () => archiveWritten.arrive(),
    commit: () => {
      holdArchive = false;
      releaseArchive();
    },
  };
}

const probeFeature = defineFeature("rebind-probe", (r) => {
  r.entity({ name: "upload", ...uploadEntity });
  r.entity({ name: "inbox", ...inboxEntity });
  r.entity({ name: "contact", ...contactEntity });
  r.writeHandler(defineEntityCreateHandler("upload", uploadEntity, { access: openToAll }));
  r.queryHandler(
    defineEntityDetailHandler("upload", uploadEntity, {
      access: { roles: ["Clerk", "UploadEditor", "UploadReader"] },
    }),
  );
  r.writeHandler(
    defineEntityUpdateHandler("upload", uploadEntity, {
      access: { roles: ["Clerk", "UploadEditor"] },
    }),
  );
  r.writeHandler(
    defineEntityDeleteHandler("upload", uploadEntity, { access: { roles: ["Clerk"] } }),
  );
  r.hook({
    type: "postSave",
    target: { allOf: "upload" },
    handler: async (result) => {
      if (!holdArchive || result.data["isArchived"] !== true) return;
      await archiveWritten.arrive();
      await archiveMayCommit;
    },
    phase: HookPhases.inTransaction,
  });
  r.writeHandler(defineEntityCreateHandler("inbox", inboxEntity, { access: openToAll }));
  r.queryHandler(defineEntityDetailHandler("inbox", inboxEntity, { access: openToAll }));
  r.writeHandler(defineEntityCreateHandler("contact", contactEntity, { access: openToAll }));
  r.queryHandler(defineEntityDetailHandler("contact", contactEntity, { access: openToAll }));
  r.writeHandler(
    defineEntityUpdateHandler("contact", contactEntity, {
      access: { roles: ["Clerk", "ContactEditor"] },
    }),
  );
  r.writeHandler({
    name: "rebind",
    schema: rebindPayload,
    access: openToAll,
    handler: async (event, ctx) => {
      const outcome = await rebindFileRef(ctx, ownersOf(event.payload));
      return { isSuccess: true as const, data: { outcome } };
    },
  });
  r.job("rebind-as-system", { trigger: { manual: true }, retries: 0 }, async (payload, ctx) => {
    const outcome = await rebindFileRef(
      { db: ctx.db, registry: ctx.registry, user: ctx.systemUser },
      ownersOf(rebindPayload.parse(payload)),
    );
    if (outcome !== "rebound") throw new Error(`rebind outcome: ${outcome}`);
  });
});

export const tenant = testTenantId(1);
export const users = {
  clerk: createTestUser({ id: 1, tenantId: tenant, roles: ["Clerk"] }),
  // Reads and edits uploads, may not edit contacts.
  uploadEditor: createTestUser({ id: 2, tenantId: tenant, roles: ["UploadEditor"] }),
  // Edits contacts, cannot read the upload.
  contactEditor: createTestUser({ id: 3, tenantId: tenant, roles: ["ContactEditor"] }),
  // Reads the upload and edits contacts, may not edit the upload.
  uploadReaderContactEditor: createTestUser({
    id: 5,
    tenantId: tenant,
    roles: ["UploadReader", "ContactEditor"],
  }),
  foreignClerk: createTestUser({ id: 4, tenantId: testTenantId(2), roles: ["Clerk"] }),
} as const;
export type ProbeUser = (typeof users)[keyof typeof users];

export const REBIND = "rebind-probe:write:rebind";
export const REBIND_JOB = "rebind-probe:job:rebind-as-system";
const PDF = new TextEncoder().encode("%PDF-1.4 rebind fixture");

export async function setupRebindStack(): Promise<TestStack> {
  patchFileInstanceofForBunTest();
  return setupTestStack({
    features: [createFilesFeature(), probeFeature],
    files: { storageProvider: createInMemoryFileProvider() },
    jobs: { consumerLane: "worker" },
  });
}

export async function uploadBoundFile(
  stack: TestStack,
  { as = users.clerk, source = "upload" }: { as?: ProbeUser; source?: SourceType } = {},
): Promise<{ fileRefId: string; uploadId: string }> {
  const form = new FormData();
  form.append("entityType", source);
  form.append("fieldName", "file");
  form.append("file", new File([Buffer.from(PDF)], "scan.pdf", { type: "application/pdf" }));
  const { body, contentType } = await buildMultipartBody(form);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${await stack.jwt.sign(as)}`, "Content-Type": contentType },
    body,
  });
  expect(res.status).toBe(201);
  const fileRefId = z.object({ id: z.string() }).parse(await res.json()).id;
  const created = await stack.http.writeOk<{ id: string }>(
    `rebind-probe:write:${source}:create`,
    { name: "Scan", file: fileRefId },
    as,
  );
  return { fileRefId, uploadId: created.id };
}

export async function createContact(stack: TestStack, as: ProbeUser = users.clerk) {
  const created = await stack.http.writeOk<{ id: string }>(
    "rebind-probe:write:contact:create",
    { name: "Ada" },
    as,
  );
  return created.id;
}

export async function rebindAs(
  stack: TestStack,
  as: ProbeUser,
  payload: RebindPayload,
): Promise<RebindFileRefOutcome> {
  const { outcome } = await stack.http.writeOk<{ outcome: RebindFileRefOutcome }>(
    REBIND,
    payload,
    as,
  );
  return outcome;
}

export async function fileStatusFor(stack: TestStack, reader: ProbeUser, fileRefId: string) {
  const res = await stack.app.request(`/api/files/${fileRefId}`, {
    headers: { Authorization: `Bearer ${await stack.jwt.sign(reader)}` },
  });
  return res.status;
}

export async function ownerOf(stack: TestStack, fileRefId: string) {
  const [row] = await selectMany(stack.db, fileRefsTable, { id: fileRefId });
  return {
    entityType: row?.["entityType"],
    entityId: row?.["entityId"],
    fieldName: row?.["fieldName"],
  };
}
