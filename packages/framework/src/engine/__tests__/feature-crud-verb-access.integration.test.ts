import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "../../db/query";
import { setupTestStack, type TestStack, TestUsers, unsafeCreateEntityTable } from "../../stack";
import { defineFeature } from "../define-feature";
import { createEntity, createTextField } from "../factories";

const propertyEntity = createEntity({
  table: "crud_verb_access_properties",
  fields: { title: createTextField({ required: true }) },
  softDelete: true,
});

const propertyFeature = defineFeature("crud-verb-access", (r) => {
  r.crud("property", propertyEntity, {
    write: { access: { roles: ["User"] } },
    read: { access: { openToAll: true } },
    verbAccess: {
      delete: { roles: ["Admin"] },
      restore: { roles: ["Admin"] },
    },
  });
});

const CREATE = "crud-verb-access:write:property:create";
const DELETE = "crud-verb-access:write:property:delete";
const RESTORE = "crud-verb-access:write:property:restore";

describe("r.crud verbAccess — real dispatcher path", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({ features: [propertyFeature] });
    await unsafeCreateEntityTable(stack.db, propertyEntity);
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  beforeEach(async () => {
    await asRawClient(stack.db).unsafe("DELETE FROM kumiko_events");
    await asRawClient(stack.db).unsafe('DELETE FROM "crud_verb_access_properties"');
  });

  test("create stays gated by write.access — User role passes", async () => {
    const res = await stack.http.write(CREATE, { title: "verbAccess create" }, TestUsers.user);
    expect(res.status).toBe(200);
  });

  test("delete overridden by verbAccess — User role (write.access) is rejected", async () => {
    const created = await stack.http.write(CREATE, { title: "to be deleted" }, TestUsers.user);
    const { data } = (await created.json()) as { data: { id: string } };

    const res = await stack.http.write(DELETE, { id: data.id }, TestUsers.user);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { isSuccess: false; error: { code: string } };
    expect(body.error.code).toBe("access_denied");
  });

  test("delete overridden by verbAccess — Admin role (verbAccess.delete) passes", async () => {
    const created = await stack.http.write(
      CREATE,
      { title: "to be deleted by admin" },
      TestUsers.user,
    );
    const { data } = (await created.json()) as { data: { id: string } };

    const res = await stack.http.write(DELETE, { id: data.id }, TestUsers.admin);
    expect(res.status).toBe(200);
  });

  test("restore overridden by verbAccess — Admin role passes, User role rejected", async () => {
    const created = await stack.http.write(CREATE, { title: "to be restored" }, TestUsers.user);
    const { data } = (await created.json()) as { data: { id: string } };
    await stack.http.write(DELETE, { id: data.id }, TestUsers.admin);

    const deniedRestore = await stack.http.write(RESTORE, { id: data.id }, TestUsers.user);
    expect(deniedRestore.status).toBe(403);

    const allowedRestore = await stack.http.write(RESTORE, { id: data.id }, TestUsers.admin);
    expect(allowedRestore.status).toBe(200);
  });
});
