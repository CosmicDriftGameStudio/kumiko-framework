import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "../../db/query";
import { setupTestStack, type TestStack, TestUsers, unsafeCreateEntityTable } from "../../stack";
import { defineFeature } from "../define-feature";
import { defineEntityUpdateHandler, defineEntityWriteHandler } from "../entity-handlers";
import { createEntity, createTextField } from "../factories";

const carEntity = createEntity({
  table: "exclude_fields_cars",
  fields: {
    vin: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    model: createTextField({ personal: false, reason: "test_fixture" }),
    internalNote: createTextField({ personal: false, reason: "test_fixture" }),
  },
});

const carFeature = defineFeature("exclude-fields", (r) => {
  r.crud("car", carEntity, {
    write: { access: { roles: ["User"] } },
    read: { access: { openToAll: { reason: "test handler callable by any signed-in test user" } } },
    excludeFields: { create: ["internalNote"], update: ["vin"] },
  });
});

const CREATE = "exclude-fields:write:car:create";
const UPDATE = "exclude-fields:write:car:update";

type WriteBody = {
  readonly isSuccess: boolean;
  readonly data?: { readonly data: Record<string, unknown> & { id: string; version: number } };
  readonly error?: {
    readonly code: string;
    readonly details?: { readonly fields?: readonly { readonly path: string }[] };
  };
};

describe("excludeFields on the generic create/update handlers", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({ features: [carFeature] });
    await unsafeCreateEntityTable(stack.db, carEntity);
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  beforeEach(async () => {
    await asRawClient(stack.db).unsafe("DELETE FROM kumiko_events");
    await asRawClient(stack.db).unsafe('DELETE FROM "exclude_fields_cars"');
  });

  async function createCar(): Promise<{ id: string; version: number }> {
    const res = await stack.http.write(CREATE, { vin: "WVW123", model: "Golf" }, TestUsers.user);
    expect(res.status).toBe(200);
    const body = (await res.json()) as WriteBody;
    if (!body.data) throw new Error("create returned no data");
    return body.data.data;
  }

  test("update rejects a payload that still carries an excluded field and keeps the row unchanged", async () => {
    const car = await createCar();

    const res = await stack.http.write(
      UPDATE,
      { id: car.id, version: car.version, changes: { vin: "HACKED", model: "Polo" } },
      TestUsers.user,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as WriteBody;
    expect(body.error?.code).toBe("validation_error");
    expect(body.error?.details?.fields?.map((field) => field.path)).toEqual(["changes.vin"]);

    const rows = await asRawClient(stack.db).unsafe(
      'SELECT vin, model FROM "exclude_fields_cars" WHERE id = $1',
      [car.id],
    );
    expect(rows[0]).toMatchObject({ vin: "WVW123", model: "Golf" });
  });

  test("update without the excluded field writes the other fields", async () => {
    const car = await createCar();

    const res = await stack.http.write(
      UPDATE,
      { id: car.id, version: car.version, changes: { model: "Polo" } },
      TestUsers.user,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as WriteBody;
    expect(body.data?.data).toMatchObject({ vin: "WVW123", model: "Polo" });
  });

  test("create honors its own exclusion list independently of update's", async () => {
    const rejected = await stack.http.write(
      CREATE,
      { vin: "WVW999", internalNote: "set by client" },
      TestUsers.user,
    );
    expect(rejected.status).toBe(400);
    const body = (await rejected.json()) as WriteBody;
    expect(body.error?.details?.fields?.map((field) => field.path)).toEqual(["internalNote"]);
  });
});

describe("excludeFields definition-time checks", () => {
  test("rejects an unknown field name", () => {
    expect(() =>
      defineEntityUpdateHandler("car", carEntity, {
        access: { roles: ["User"] },
        excludeFields: ["colour"],
      }),
    ).toThrow(/unknown field "colour"/);
  });

  test("rejects excluding a required field without default on create", () => {
    expect(() =>
      defineEntityWriteHandler("car:create", carEntity, {
        access: { roles: ["User"] },
        excludeFields: ["vin"],
      }),
    ).toThrow(/required without a default/);
  });

  test("rejects excludeFields on delete", () => {
    expect(() =>
      defineEntityWriteHandler("car:delete", carEntity, {
        access: { roles: ["User"] },
        excludeFields: ["model"],
      }),
    ).toThrow(/only applies to create and update/);
  });
});
