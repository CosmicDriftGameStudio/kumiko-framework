import {
  createEntity,
  createEntityExecutor,
  createFileField,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDeleteHandler,
  defineEntityDetailHandler,
  defineEntityListHandler,
  defineEntityUpdateHandler,
  defineFeature,
  defineQueryHandler,
  SYSTEM_ROLE,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  bindPendingFileRef,
  createFileRefFromBytes,
  createFilesFeature,
  createInMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  buildMultipartBody,
  patchFileInstanceofForBunTest,
} from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { documentIdForFile } from "../aggregate-id.ts";
import { createDocumentsFeature, type DocumentsFeatureOptions } from "../feature.ts";

export const tenant = testTenantId(1);
export const otherTenant = testTenantId(2);

// One role per question the gate answers: who reads which host, who edits it, who may open the
// admin view, and a role that sees nothing.
export const users = {
  admin: createTestUser({ id: 1, tenantId: tenant, roles: ["TenantAdmin"] }),
  propertyReader: createTestUser({ id: 2, tenantId: tenant, roles: ["PropertyReader"] }),
  leaseReader: createTestUser({ id: 3, tenantId: tenant, roles: ["LeaseReader"] }),
  editor: createTestUser({ id: 4, tenantId: tenant, roles: ["PropertyReader", "PropertyEditor"] }),
  nobody: createTestUser({ id: 5, tenantId: tenant, roles: ["Nobody"] }),
  memoAndProperty: createTestUser({
    id: 6,
    tenantId: tenant,
    roles: ["PropertyReader", "MemoReader"],
  }),
  secretReader: createTestUser({ id: 7, tenantId: tenant, roles: ["LeaseReader", "SecretReader"] }),
  foreign: createTestUser({ id: 8, tenantId: otherTenant, roles: ["TenantAdmin"] }),
};
export type TestUser = (typeof users)["admin"];

const openToAll = { openToAll: { reason: "test handler callable by any signed-in test user" } };
const text = (maxLength: number) =>
  createTextField({ required: true, maxLength, personal: false, reason: "test_fixture" });

export const propertyEntity = createEntity({
  table: "doc_t_properties",
  fields: { name: text(64) },
  access: { read: { PropertyReader: "all", TenantAdmin: "all" } },
});
export const leaseEntity = createEntity({
  table: "doc_t_leases",
  fields: {
    name: text(64),
    propertyId: text(64),
    file: createFileField(),
    secret: createFileField({ access: { read: { SecretReader: "all", TenantAdmin: "all" } } }),
  },
  access: { read: { LeaseReader: "all", TenantAdmin: "all" } },
});
// Readable by role, but no query handler is registered for it: the handler gate must hide its files.
export const memoEntity = createEntity({
  table: "doc_t_memos",
  fields: { name: text(64), propertyId: text(64), file: createFileField() },
  access: { read: { MemoReader: "all", TenantAdmin: "all" } },
});

// Its detail query is TenantAdmin-only, while an open query names it in liveEntities: only the
// detail query decides who may open a vault record, and with it the documents it owns.
export const vaultEntity = createEntity({
  table: "doc_t_vaults",
  fields: { name: text(64), propertyId: text(64), file: createFileField() },
});

const PDF = new TextEncoder().encode("%PDF-1.4 fixture");

export const hostFeature = defineFeature("doc-fixtures", (r) => {
  r.entity({ name: "property", ...propertyEntity });
  r.entity({ name: "lease", ...leaseEntity });
  r.entity({ name: "memo", ...memoEntity });
  r.entity({ name: "vault", ...vaultEntity });
  for (const [name, entity] of [
    ["property", propertyEntity],
    ["lease", leaseEntity],
  ] as const) {
    r.writeHandler(defineEntityCreateHandler(name, entity, { access: openToAll }));
    r.queryHandler(defineEntityListHandler(name, entity, { access: openToAll }));
    r.queryHandler(defineEntityDetailHandler(name, entity, { access: openToAll }));
  }
  r.writeHandler(defineEntityCreateHandler("memo", memoEntity, { access: openToAll }));
  r.writeHandler(defineEntityCreateHandler("vault", vaultEntity, { access: openToAll }));
  r.queryHandler(
    defineEntityDetailHandler("vault", vaultEntity, { access: { roles: ["TenantAdmin"] } }),
  );
  r.queryHandler(
    defineQueryHandler({
      name: "vault-signal",
      schema: z.object({}),
      access: openToAll,
      liveEntities: ["vault"],
      description: "Test query that names the vault entity in liveEntities without reading it.",
      handler: async () => ({}),
    }),
  );
  r.writeHandler(
    defineEntityUpdateHandler("property", propertyEntity, {
      access: { roles: ["PropertyEditor", "TenantAdmin"] },
    }),
  );
  r.writeHandler(defineEntityUpdateHandler("lease", leaseEntity, { access: openToAll }));
  r.writeHandler(defineEntityDeleteHandler("lease", leaseEntity, { access: openToAll }));

  // The file a job generates (a rendered PDF) is bound to the record through a normal save.
  r.writeHandler({
    name: "lease:set-file",
    schema: z.object({ id: z.uuid(), version: z.number(), file: z.uuid() }),
    access: { roles: [SYSTEM_ROLE] },
    handler: async (event, ctx) =>
      createEntityExecutor("lease", leaseEntity).executor.update(
        {
          id: event.payload.id,
          version: event.payload.version,
          changes: { file: event.payload.file },
        },
        event.user,
        ctx.db,
      ),
  });
  r.job("import-document", { trigger: { manual: true }, retries: 0 }, async (payload, ctx) => {
    const id = z.uuid().parse(payload["id"]);
    const stored = await createFileRefFromBytes(
      { ...ctx, user: ctx.systemUser },
      {
        fileName: "imported.pdf",
        mimeType: "application/pdf",
        data: PDF,
        attachTo: { entityType: "filed-document", entityId: id, fieldName: "file" },
      },
    );
    if (!stored.isSuccess) throw new Error(stored.error.message);
    const imported = await ctx.dispatch.write("documents:write:import", {
      id,
      title: "Imported",
      category: "contract",
      ...(typeof payload["validUntil"] === "string" && { validUntil: payload["validUntil"] }),
      fileRefId: stored.data.id,
      links: [{ entityType: "property", entityId: z.string().parse(payload["propertyId"]) }],
      ...(payload["deleted"] === true && { deleted: true }),
    });
    if (!imported.isSuccess) throw new Error(imported.error.message);
  });
  // A generated file bound to a record without any save: the lease field never names it, so only
  // the explicit import brings it in as a document.
  r.job("bind-and-import", { trigger: { manual: true }, retries: 0 }, async (payload, ctx) => {
    const leaseId = z.uuid().parse(payload["leaseId"]);
    const stored = await createFileRefFromBytes(
      { ...ctx, user: ctx.systemUser },
      {
        fileName: "bound.pdf",
        mimeType: "application/pdf",
        data: PDF,
        attachTo: { entityType: "lease", fieldName: "file" },
      },
    );
    if (!stored.isSuccess) throw new Error(stored.error.message);
    const outcome = await bindPendingFileRef({
      fileRefId: stored.data.id,
      entityName: "lease",
      fieldName: "file",
      entityId: leaseId,
      user: ctx.systemUser,
      db: ctx.db,
    });
    if (outcome !== "bound") throw new Error(`bind outcome: ${outcome}`);
    const imported = await ctx.dispatch.write("documents:write:import", {
      id: documentIdForFile(ctx.systemUser.tenantId, stored.data.id),
      title: "Bound",
      category: "contract",
      fileRefId: stored.data.id,
      links: [{ entityType: "lease", entityId: leaseId }],
    });
    if (!imported.isSuccess) throw new Error(imported.error.message);
  });
  r.job("render-lease-pdf", { trigger: { manual: true }, retries: 0 }, async (payload, ctx) => {
    const leaseId = z.uuid().parse(payload["leaseId"]);
    const stored = await createFileRefFromBytes(
      { ...ctx, user: ctx.systemUser },
      {
        fileName: "rendered.pdf",
        mimeType: "application/pdf",
        data: PDF,
        attachTo: { entityType: "lease", entityId: leaseId, fieldName: "file" },
      },
    );
    if (!stored.isSuccess) throw new Error(stored.error.message);
    const written = await ctx.dispatch.write("doc-fixtures:write:lease:set-file", {
      id: leaseId,
      version: z.number().parse(payload["version"]),
      file: stored.data.id,
    });
    if (!written.isSuccess) throw new Error(written.error.message);
  });
});

export const documentsFeature = createFixtureDocumentsFeature();

export function createFixtureDocumentsFeature(
  options: Pick<DocumentsFeatureOptions, "linkReadMode"> = {},
) {
  return createDocumentsFeature({
    ...options,
    categories: ["contract", "id"],
    linkTargets: ["property", "lease"],
    access: openToAll,
    // Every test role reads all the gate allows; the system role is left out on purpose, so
    // capture and import must work without it.
    readAccess: Object.fromEntries(
      [
        "TenantAdmin",
        "PropertyReader",
        "LeaseReader",
        "PropertyEditor",
        "Nobody",
        "MemoReader",
        "SecretReader",
      ].map((role) => [role, "all" as const]),
    ),
    capture: [
      {
        entity: "lease",
        field: "file",
        category: "contract",
        title: (row) => `Lease ${String(row["name"])}`,
        links: (row) => [{ entityType: "property", entityId: String(row["propertyId"]) }],
      },
      { entity: "lease", field: "secret", category: "id", title: () => "Secret" },
      {
        entity: "vault",
        field: "file",
        category: "contract",
        title: () => "Vault",
        links: (row) => [{ entityType: "property", entityId: String(row["propertyId"]) }],
      },
      {
        entity: "memo",
        field: "file",
        category: "contract",
        title: () => "Memo",
        links: (row) => [{ entityType: "property", entityId: String(row["propertyId"]) }],
      },
    ],
  });
}

export async function uploadFile(
  stack: TestStack,
  as: TestUser,
  entityType: string,
  fieldName: string,
): Promise<string> {
  const token = await stack.jwt.sign(as);
  const form = new FormData();
  form.append("entityType", entityType);
  form.append("fieldName", fieldName);
  form.append("file", new File([Buffer.from(PDF)], "doc.pdf", { type: "application/pdf" }));
  const { body, contentType } = await buildMultipartBody(form);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
  });
  if (res.status !== 201) throw new Error(`upload failed: ${res.status}`);
  return z.object({ id: z.string() }).parse(await res.json()).id;
}

// The migration path: a SYSTEM job creates the file bound to the document and imports it.
export const IMPORT_JOB = "doc-fixtures:job:import-document";

export const FIXED_NOW = "2026-06-15T10:00:00Z";

export async function setupDocumentStack(documents = documentsFeature): Promise<TestStack> {
  patchFileInstanceofForBunTest();
  return setupTestStack({
    features: [createFilesFeature(), hostFeature, documents],
    files: { storageProvider: createInMemoryFileProvider() },
    jobs: { consumerLane: "worker" },
    extraContext: { clock: { now: () => Temporal.Instant.from(FIXED_NOW) } },
  });
}

export async function seedProperty(stack: TestStack, name: string): Promise<string> {
  const created = await stack.http.writeOk<{ id: string }>(
    "doc-fixtures:write:property:create",
    { name },
    users.admin,
  );
  return created.id;
}

export async function seedLease(
  stack: TestStack,
  propertyId: string,
  options: { name: string; secret?: boolean },
): Promise<string> {
  const file = await uploadFile(stack, users.admin, "lease", "file");
  const secret = options.secret
    ? await uploadFile(stack, users.admin, "lease", "secret")
    : undefined;
  const created = await stack.http.writeOk<{ id: string }>(
    "doc-fixtures:write:lease:create",
    { name: options.name, propertyId, file, ...(secret !== undefined && { secret }) },
    users.admin,
  );
  return created.id;
}

export type DocumentRow = { id: string; title: string; file: string; validUntil?: string | null };
export type DocumentPage = { rows: readonly DocumentRow[]; total?: number };

export function visibleDocuments(
  stack: TestStack,
  as: TestUser,
  payload: Record<string, unknown> = {},
): Promise<DocumentPage> {
  return stack.http.queryOk<DocumentPage>(
    "documents:query:filed-document:list",
    { limit: 100, totalCount: true, ...payload },
    as,
  );
}

export function documentsOf(
  stack: TestStack,
  as: TestUser,
  entityType: string,
  entityId: string,
): Promise<DocumentPage> {
  return stack.http.queryOk<DocumentPage>(
    "documents:query:for-record",
    { entityType, entityId, limit: 100, totalCount: true },
    as,
  );
}
