// A writer gets the rows of an embedded field without the sub-fields he may not read. Saving those
// rows back must keep the hidden values (and their files) instead of replacing the whole field.
// Real stack, real HTTP calls.

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
import {
  createEmbeddedField,
  createEmbeddedListField,
  createEntity,
  createSystemUser,
  createTextField,
  defineFeature,
  from,
} from "../../engine/index.ts";
import type { SessionUser } from "../../engine/types/index.ts";
import { createFilesFeature } from "../../files/feature.ts";
import { createInMemoryFileProvider } from "../../files/in-memory-provider.ts";
import { createTestUser, TestUsers, testTenantId } from "../../seeding/seed-users.ts";
import { createEventStoreExecutor, WritePurposes } from "../event-store-executor.ts";
import { buildEntityTable } from "../table-builder.ts";

const ADMIN_ONLY = ["Admin"];

const ledgerEntity = createEntity({
  name: "ledger",
  table: "hidden_sub_field_ledgers",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
    lines: createEmbeddedListField(
      {
        note: { type: "text" },
        internalNote: { type: "text", access: { read: ADMIN_ONLY } },
        scans: { type: "files", access: { read: ADMIN_ONLY } },
      },
      { personal: false, reason: "is_business_data" },
    ),
    summary: createEmbeddedField(
      {
        note: { type: "text" },
        internalNote: { type: "text", access: { read: ADMIN_ONLY } },
      },
      { personal: false, reason: "is_business_data" },
    ),
    // Each row is read by its owner, so the writer may read one row and not the next.
    tasks: createEmbeddedListField(
      {
        owner: { type: "text" },
        secret: {
          type: "text",
          access: { read: { Admin: "all", Clerk: from("user:id", "owner") } },
        },
      },
      { personal: false, reason: "is_business_data" },
    ),
  },
});

const hiddenSubFieldFeature = defineFeature("hidden-sub-field", (r) => {
  r.crud(ledgerEntity, {
    write: { access: { roles: ["Admin", "Clerk"] } },
    read: { access: { roles: ["Admin", "Clerk"] } },
  });
  const executor = createEventStoreExecutor(buildEntityTable(ledgerEntity), ledgerEntity, {
    entityName: "ledger",
  });
  // A retention or erasure job: the framework system user names a writePurpose.
  r.writeHandler({
    name: "ledger:retention-anonymize",
    schema: z.object({ id: z.uuid() }),
    handler: async (event, ctx) =>
      executor.update(
        { id: event.payload.id, changes: { lines: [{ note: "[ANON]", internalNote: null }] } },
        createSystemUser(event.user.tenantId),
        ctx.db,
        { skipOptimisticLock: true, writePurpose: WritePurposes.retention },
      ),
    access: { roles: ["Admin"] },
  });
});

const tenant = testTenantId(1);
const admin = TestUsers.admin;
const clerk = createTestUser({ id: 31, tenantId: tenant, roles: ["Clerk"] });

const PDF_BYTES = "%PDF-1.4 hidden sub-field";

let stack: TestStack;

async function uploadScan(): Promise<string> {
  const fd = new FormData();
  fd.append("entityType", "ledger");
  fd.append("fieldName", "lines");
  fd.append("subField", "scans");
  fd.append("file", new File([Buffer.from(PDF_BYTES)], "scan.pdf", { type: "application/pdf" }));
  const { body, contentType } = await buildMultipartBody(fd);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await stack.jwt.sign(admin)}`,
      "Content-Type": contentType,
    },
    body,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function downloadStatus(as: SessionUser, fileRefId: string): Promise<number> {
  const res = await stack.app.request(`/api/files/${fileRefId}`, {
    headers: { Authorization: `Bearer ${await stack.jwt.sign(as)}` },
  });
  return res.status;
}

async function createLedger(values: Record<string, unknown>): Promise<string> {
  const created = await stack.http.writeOk<{ id: string }>(
    "hidden-sub-field:write:ledger:create",
    { title: "Ledger", ...values },
    admin,
  );
  return created.id;
}

async function detail(as: SessionUser, id: string): Promise<Record<string, unknown>> {
  return stack.http.queryOk<Record<string, unknown>>(
    "hidden-sub-field:query:ledger:detail",
    { id },
    as,
  );
}

async function update(as: SessionUser, id: string, changes: Record<string, unknown>) {
  return stack.http.writeOk(
    "hidden-sub-field:write:ledger:update",
    { id, version: 1, changes },
    as,
  );
}

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  stack = await setupTestStack({
    features: [createFilesFeature(), hiddenSubFieldFeature],
    files: { storageProvider: createInMemoryFileProvider() },
  });
  await unsafeCreateEntityTable(stack.db, ledgerEntity, "ledger");
});

afterAll(async () => {
  await stack.cleanup();
});

describe("a writer saves back the rows he got without the sub-fields he may not read", () => {
  test("a hidden text sub-field keeps its value", async () => {
    const id = await createLedger({ lines: [{ note: "a", internalNote: "keep" }] });
    const seen = await detail(clerk, id);
    expect(seen["lines"]).toEqual([{ note: "a" }]);

    await update(clerk, id, { lines: [{ note: "a2" }] });

    expect((await detail(admin, id))["lines"]).toEqual([{ note: "a2", internalNote: "keep" }]);
  });

  test("a hidden file sub-field keeps its file, still downloadable", async () => {
    const scan = await uploadScan();
    const id = await createLedger({ lines: [{ note: "a", scans: [scan] }] });
    expect((await detail(clerk, id))["lines"]).toEqual([{ note: "a" }]);

    await update(clerk, id, { lines: [{ note: "a2" }] });

    expect((await detail(admin, id))["lines"]).toEqual([{ note: "a2", scans: [scan] }]);
    expect(await downloadStatus(admin, scan)).toBe(200);
  });

  test("a value the writer sends at the hidden place is refused, the old one stays", async () => {
    const id = await createLedger({ lines: [{ note: "a", internalNote: "keep" }] });

    const err = await stack.http.writeErr(
      "hidden-sub-field:write:ledger:update",
      { id, version: 1, changes: { lines: [{ note: "a2", internalNote: "overwritten" }] } },
      clerk,
    );

    expect(err.code).toBe("validation_error");
    expect(err.details).toEqual({
      fields: [
        {
          path: "lines",
          code: "hidden_row_changed",
          i18nKey: "errors.validation.hidden_row_changed",
        },
      ],
    });
    expect((await detail(admin, id))["lines"]).toEqual([{ note: "a", internalNote: "keep" }]);
  });

  // A guess that matches the hidden value gets the same answer as one that does not.
  test("sending the hidden value itself is refused as well", async () => {
    const id = await createLedger({ lines: [{ note: "a", internalNote: "keep" }] });

    const err = await stack.http.writeErr(
      "hidden-sub-field:write:ledger:update",
      { id, version: 1, changes: { lines: [{ note: "a", internalNote: "keep" }] } },
      clerk,
    );

    expect(JSON.stringify(err.details)).toContain("hidden_row_changed");
  });

  test("the save response does not carry the hidden value", async () => {
    const id = await createLedger({ lines: [{ note: "a", internalNote: "keep" }] });

    const response = await update(clerk, id, { lines: [{ note: "a2" }] });

    expect(JSON.stringify(response)).toContain("a2");
    expect(JSON.stringify(response)).not.toContain("keep");
  });

  test("dropping a row with a hidden value is rejected with a validation error on the field", async () => {
    const id = await createLedger({
      lines: [{ note: "a" }, { note: "b", internalNote: "keep" }],
    });

    const err = await stack.http.writeErr(
      "hidden-sub-field:write:ledger:update",
      { id, version: 1, changes: { lines: [{ note: "a" }] } },
      clerk,
    );

    expect(err.code).toBe("validation_error");
    expect(err.details).toEqual({
      fields: [
        {
          path: "lines",
          code: "hidden_row_removed",
          i18nKey: "errors.validation.hidden_row_removed",
        },
      ],
    });
    expect((await detail(admin, id))["lines"]).toEqual([
      { note: "a" },
      { note: "b", internalNote: "keep" },
    ]);
  });

  test("dropping a row without a hidden value saves", async () => {
    const id = await createLedger({
      lines: [{ note: "a", internalNote: "keep" }, { note: "b" }],
    });

    await update(clerk, id, { lines: [{ note: "a" }] });

    expect((await detail(admin, id))["lines"]).toEqual([{ note: "a", internalNote: "keep" }]);
  });

  test("appending a row saves and keeps the hidden values of the rows before", async () => {
    const id = await createLedger({ lines: [{ note: "a", internalNote: "keep" }] });

    await update(clerk, id, { lines: [{ note: "a" }, { note: "b" }] });

    expect((await detail(admin, id))["lines"]).toEqual([
      { note: "a", internalNote: "keep" },
      { note: "b" },
    ]);
  });

  test("a writer who may read the sub-field still changes and drops it", async () => {
    const scan = await uploadScan();
    const id = await createLedger({
      lines: [
        { note: "a", internalNote: "old" },
        { note: "b", internalNote: "gone", scans: [scan] },
      ],
    });

    await update(admin, id, { lines: [{ note: "a", internalNote: "new" }] });

    expect((await detail(admin, id))["lines"]).toEqual([{ note: "a", internalNote: "new" }]);
    expect(await downloadStatus(admin, scan)).toBe(404);
  });

  test("a row rule: the writer changes the row he may read, the other keeps its value", async () => {
    const id = await createLedger({
      tasks: [
        { owner: clerk.id, secret: "mine" },
        { owner: "someone-else", secret: "theirs" },
      ],
    });
    expect((await detail(clerk, id))["tasks"]).toEqual([
      { owner: clerk.id, secret: "mine" },
      { owner: "someone-else" },
    ]);

    await update(clerk, id, {
      tasks: [{ owner: clerk.id, secret: "mine, edited" }, { owner: "someone-else" }],
    });

    expect((await detail(admin, id))["tasks"]).toEqual([
      { owner: clerk.id, secret: "mine, edited" },
      { owner: "someone-else", secret: "theirs" },
    ]);
  });

  test("a row rule: taking over a row the writer may not read does not reveal its value", async () => {
    const id = await createLedger({ tasks: [{ owner: "someone-else", secret: "theirs" }] });

    const err = await stack.http.writeErr(
      "hidden-sub-field:write:ledger:update",
      { id, version: 1, changes: { tasks: [{ owner: clerk.id }] } },
      clerk,
    );

    expect(err.code).toBe("validation_error");
    expect(JSON.stringify(err.details)).toContain("hidden_row_changed");
    expect((await detail(clerk, id))["tasks"]).toEqual([{ owner: "someone-else" }]);
    expect((await detail(admin, id))["tasks"]).toEqual([
      { owner: "someone-else", secret: "theirs" },
    ]);
  });

  test("a single embedded object keeps its hidden value", async () => {
    const id = await createLedger({ summary: { note: "a", internalNote: "keep" } });
    expect((await detail(clerk, id))["summary"]).toEqual({ note: "a" });

    await update(clerk, id, { summary: { note: "a2" } });

    expect((await detail(admin, id))["summary"]).toEqual({ note: "a2", internalNote: "keep" });
  });
});

describe("a statutory system write", () => {
  test("clears a sub-field the system user may not read", async () => {
    const id = await createLedger({ lines: [{ note: "a", internalNote: "salary 4200" }] });

    await stack.http.writeOk("hidden-sub-field:write:ledger:retention-anonymize", { id }, admin);

    const lines = JSON.stringify((await detail(admin, id))["lines"]);
    expect(lines).toContain("[ANON]");
    expect(lines).not.toContain("salary 4200");
  });
});
