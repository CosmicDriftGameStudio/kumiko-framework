// A readGate.fileOwner row passes when its fileRef belongs to a readable owner. A read-model
// entity (projection entity) owns files too, but only with its own access.read and a detail
// query the viewer's roles may call: owner readability never exceeds the read model's own reads.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedRows } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { buildEntityTable } from "../../db/table-builder.ts";
import { createFilesFeature } from "../../files/feature.ts";
import { fileRefsTable } from "../../files/file-ref-table.ts";
import { createLocalProvider } from "../../files/local-provider.ts";
import { createTestUser, testTenantId } from "../../seeding/seed-users.ts";
import { defineFeature } from "../define-feature.ts";
import { createEntity, createFileField, createTextField } from "../factories.ts";

const text = () => createTextField({ personal: false, reason: "test_fixture" });

const readableOwnerEntity = createEntity({
  table: "rm_gate_owners",
  fields: { title: text(), scan: createFileField() },
  access: { read: { RoleA: "all" } },
});
const ruleLessOwnerEntity = createEntity({
  table: "rm_gate_rule_less_owners",
  fields: { title: text(), scan: createFileField() },
});
const documentEntity = createEntity({
  table: "rm_gate_documents",
  fields: { title: text(), file: createFileField() },
  readGate: { fileOwner: { field: "file" } },
});

const readableOwnerTable = buildEntityTable("readable-owner", readableOwnerEntity);
const ruleLessOwnerTable = buildEntityTable("rule-less-owner", ruleLessOwnerEntity);
const documentTable = buildEntityTable("document", documentEntity);

const feature = defineFeature("rmgate", (r) => {
  r.defineEvent("owner-seen", z.object({}), { piiFields: "none" });
  r.projection({
    name: "readable-owner",
    source: "readable-owner",
    table: readableOwnerTable,
    entity: readableOwnerEntity,
    apply: { "rmgate:event:owner-seen": async () => {} },
  });
  r.projection({
    name: "rule-less-owner",
    source: "rule-less-owner",
    table: ruleLessOwnerTable,
    entity: ruleLessOwnerEntity,
    apply: { "rmgate:event:owner-seen": async () => {} },
  });
  for (const name of ["readable-owner", "rule-less-owner"]) {
    r.queryHandler({
      name: `${name}:detail`,
      schema: z.object({ id: z.uuid() }),
      access: { roles: ["RoleA"] },
      handler: async () => null,
    });
  }
  r.crud("document", documentEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: { roles: ["RoleA", "RoleB"] } },
  });
});

const tenantOne = testTenantId(1);
const roleA = createTestUser({ id: 1, tenantId: tenantOne, roles: ["RoleA"] });
const roleB = createTestUser({ id: 2, tenantId: tenantOne, roles: ["RoleB"] });
const otherTenantRoleA = createTestUser({ id: 3, tenantId: testTenantId(2), roles: ["RoleA"] });

const OWNER_ID = "a0000000-0000-4000-8000-000000000001";
const RULE_LESS_OWNER_ID = "a0000000-0000-4000-8000-000000000002";
const READABLE_FILE_ID = "f0000000-0000-4000-8000-000000000001";
const RULE_LESS_FILE_ID = "f0000000-0000-4000-8000-000000000002";
const READABLE_DOC_ID = "d0000000-0000-4000-8000-000000000001";
const RULE_LESS_DOC_ID = "d0000000-0000-4000-8000-000000000002";
const LIST = "rmgate:query:document:list";
const DETAIL = "rmgate:query:document:detail";

let stack: TestStack;
let storagePath: string;

function fileRefRow(id: string, entityType: string, entityId: string) {
  return {
    id,
    tenantId: tenantOne,
    storageKey: `k-${id}`,
    fileName: "scan.pdf",
    mimeType: "application/pdf",
    size: 1n,
    entityType,
    entityId,
    fieldName: "scan",
  };
}

beforeAll(async () => {
  storagePath = await mkdtemp(join(tmpdir(), "kumiko-rm-gate-"));
  stack = await setupTestStack({
    features: [createFilesFeature(), feature],
    files: { storageProvider: createLocalProvider(storagePath) },
  });
  await unsafeCreateEntityTable(stack.db, readableOwnerEntity, "readable-owner");
  await unsafeCreateEntityTable(stack.db, ruleLessOwnerEntity, "rule-less-owner");
  await unsafeCreateEntityTable(stack.db, documentEntity, "document");
  await seedRows(stack.db, readableOwnerTable, [
    { id: OWNER_ID, tenantId: tenantOne, title: "Mail" },
  ]);
  await seedRows(stack.db, ruleLessOwnerTable, [
    { id: RULE_LESS_OWNER_ID, tenantId: tenantOne, title: "Open mail" },
  ]);
  await seedRows(stack.db, fileRefsTable, [
    fileRefRow(READABLE_FILE_ID, "readable-owner", OWNER_ID),
    fileRefRow(RULE_LESS_FILE_ID, "rule-less-owner", RULE_LESS_OWNER_ID),
  ]);
  await seedRows(stack.db, documentTable, [
    { id: READABLE_DOC_ID, tenantId: tenantOne, title: "readable", file: READABLE_FILE_ID },
    { id: RULE_LESS_DOC_ID, tenantId: tenantOne, title: "rule-less", file: RULE_LESS_FILE_ID },
  ]);
});

afterAll(async () => {
  await stack.cleanup();
  await rm(storagePath, { recursive: true, force: true });
});

async function listedIds(as: typeof roleA): Promise<string[]> {
  const result = await stack.http.queryOk<{ rows: { id: string }[] }>(LIST, { limit: 50 }, as);
  return result.rows.map((row) => row.id);
}

describe("readGate.fileOwner with a read-model owner", () => {
  test("a role that reads the read model sees the document its file belongs to", async () => {
    expect(await listedIds(roleA)).toEqual([READABLE_DOC_ID]);
    const detail = await stack.http.queryOk<{ id: string } | null>(
      DETAIL,
      { id: READABLE_DOC_ID },
      roleA,
    );
    expect(detail?.id).toBe(READABLE_DOC_ID);
  });

  test("a role without read access to the read model does not see the document", async () => {
    expect(await listedIds(roleB)).toEqual([]);
    const detail = await stack.http.queryOk<{ id: string } | null>(
      DETAIL,
      { id: READABLE_DOC_ID },
      roleB,
    );
    expect(detail).toBeNull();
  });

  test("a read model without access.read never makes its documents visible", async () => {
    const detail = await stack.http.queryOk<{ id: string } | null>(
      DETAIL,
      { id: RULE_LESS_DOC_ID },
      roleA,
    );
    expect(detail).toBeNull();
  });

  test("another tenant sees nothing", async () => {
    expect(await listedIds(otherTenantRoleA)).toEqual([]);
  });
});
