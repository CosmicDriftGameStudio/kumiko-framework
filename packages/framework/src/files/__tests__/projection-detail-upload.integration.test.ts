// A file picked in a projectionDetail writeForm uploads as the host entity's field (`uploadEntity`),
// so a handler that saves it through that entity's executor binds it: another record reader can
// then download it. Real stack, real HTTP calls.

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
  createTextField,
  defineFeature,
} from "../../engine/index.ts";
import type { SessionUser } from "../../engine/types/index.ts";
import { createTestUser, TestUsers, testTenantId } from "../../seeding/seed-users.ts";
import { createFilesFeature } from "../feature.ts";
import { fileRefsTable } from "../file-ref-table.ts";
import { createInMemoryFileProvider } from "../in-memory-provider.ts";

const dossierEntity = createEntity({
  name: "dossier",
  table: "detail_upload_dossiers",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
    attachment: createFileField({ accept: ["pdf"] }),
  },
});
const dossierTable = buildEntityTable(dossierEntity);

const WRITERS = { access: { roles: ["Admin"] } } as const;
const READERS = { access: { roles: ["Admin", "User"] } } as const;

const probeFeature = defineFeature("detail-upload", (r) => {
  r.crud(dossierEntity, { write: WRITERS, read: READERS });
  const executor = createEventStoreExecutor(dossierTable, dossierEntity, {
    entityName: "dossier",
  });
  r.writeHandler({
    name: "dossier:attach",
    schema: z.object({ id: z.uuid(), version: z.number(), attachment: z.string() }),
    handler: async (event, ctx) =>
      executor.update(
        {
          id: event.payload.id,
          version: event.payload.version,
          changes: { attachment: event.payload.attachment },
        },
        event.user,
        ctx.db,
      ),
    ...WRITERS,
  });
  r.screen({
    id: "dossier-detail",
    type: "projectionDetail",
    dormant: true,
    query: "detail-upload:query:dossier:detail",
    layout: {
      sections: [
        { title: "Facts", fields: ["title"] },
        {
          kind: "writeForm",
          placement: "footer",
          uploadEntity: "dossier",
          fieldDefs: { attachment: createFileField({ accept: ["pdf"] }) },
          fields: ["attachment"],
          actions: [
            { id: "attach", label: "Attach", handler: "detail-upload:write:dossier:attach" },
          ],
        },
      ],
    },
  });
});

const tenant = testTenantId(1);
const uploader = TestUsers.admin;
const otherReader = createTestUser({ id: 31, tenantId: tenant, roles: ["User"] });
const PDF_BYTES = "%PDF-1.4 detail upload";

let stack: TestStack;

// The request the footer's file field sends: entityType and fieldName, no entityId.
async function uploadAsFooterDoes(): Promise<string> {
  const fd = new FormData();
  fd.append("entityType", "dossier");
  fd.append("fieldName", "attachment");
  fd.append("file", new File([Buffer.from(PDF_BYTES)], "doc.pdf", { type: "application/pdf" }));
  const { body, contentType } = await buildMultipartBody(fd);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await stack.jwt.sign(uploader)}`,
      "Content-Type": contentType,
    },
    body,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function download(as: SessionUser, fileRefId: string): Promise<Response> {
  return stack.app.request(`/api/files/${fileRefId}`, {
    headers: { Authorization: `Bearer ${await stack.jwt.sign(as)}` },
  });
}

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  stack = await setupTestStack({
    features: [createFilesFeature(), probeFeature],
    files: { storageProvider: createInMemoryFileProvider() },
  });
  await unsafeCreateEntityTable(stack.db, dossierEntity, "dossier");
});

afterAll(async () => {
  await stack.cleanup();
});

describe("projectionDetail writeForm file upload via uploadEntity", () => {
  test("an update through the entity executor binds the upload so another record reader downloads it", async () => {
    const fileRefId = await uploadAsFooterDoes();
    expect((await download(otherReader, fileRefId)).status).toBe(404);

    const created = await stack.http.writeOk<{ id: string }>(
      "detail-upload:write:dossier:create",
      { title: "Roof" },
      uploader,
    );
    const record = await stack.http.queryOk<{ version: number }>(
      "detail-upload:query:dossier:detail",
      { id: created.id },
      uploader,
    );
    await stack.http.writeOk(
      "detail-upload:write:dossier:attach",
      { id: created.id, version: record.version, attachment: fileRefId },
      uploader,
    );

    const [row] = await selectMany(stack.db, fileRefsTable, { id: fileRefId });
    expect(row).toMatchObject({
      entityType: "dossier",
      fieldName: "attachment",
      entityId: created.id,
    });
    const res = await download(otherReader, fileRefId);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(PDF_BYTES);
  });
});
