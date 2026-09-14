// The schema lets a caller id through, but only a system identity gets it honored; HTTP users
// can never present one (SYSTEM_ROLE is reserved), so both halves are pinned end to end here.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { setupTestStack, type TestStack, TestUsers, unsafeCreateEntityTable } from "../../stack";
import {
  createEntity,
  createSystemUser,
  createTextField,
  defineEntityCreateHandler,
  defineFeature,
} from "../index";

const thingEntity = createEntity({
  table: "callerid_things",
  fields: {
    label: createTextField({ required: true, personal: false, reason: "test_fixture" }),
  },
  access: { write: { Admin: "all" } },
});
const CREATE_QN = "callerid:write:thing:create";

const feature = defineFeature("callerid", (r) => {
  r.entity("thing", thingEntity);
  r.writeHandler(defineEntityCreateHandler("thing", thingEntity, { access: { roles: ["Admin"] } }));
});

let stack: TestStack;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
  await unsafeCreateEntityTable(stack.db, thingEntity, "thing");
});

afterAll(async () => {
  await stack.cleanup();
});

describe("entity create — caller-chosen id", () => {
  test("system-identity caller: the chosen id is honored", async () => {
    const chosenId = "00000000-0000-4000-8000-0000000000c1";
    const systemUser = createSystemUser(admin.tenantId, ["Admin"]);
    const result = await stack.http.writeOk<{ id: string }>(
      CREATE_QN,
      { label: "from a job", id: chosenId },
      systemUser,
    );
    expect(result.id).toBe(chosenId);
  });

  test("system-identity caller retrying the same id → version_conflict, no duplicate row created", async () => {
    const chosenId = "00000000-0000-4000-8000-0000000000c2";
    const systemUser = createSystemUser(admin.tenantId, ["Admin"]);
    await stack.http.writeOk<{ id: string }>(
      CREATE_QN,
      { label: "first attempt", id: chosenId },
      systemUser,
    );
    const retry = await stack.http.writeErr(
      CREATE_QN,
      { label: "redelivered event", id: chosenId },
      systemUser,
    );
    expect(retry.code).toBe("version_conflict");
  });

  test("ordinary end user: the payload id is ignored, a fresh id is minted", async () => {
    const chosenId = "00000000-0000-4000-8000-0000000000c3";
    const result = await stack.http.writeOk<{ id: string }>(
      CREATE_QN,
      { label: "from a browser", id: chosenId },
      admin,
    );
    expect(result.id).not.toBe(chosenId);
  });

  test("malformed id → validation error, regardless of caller identity", async () => {
    const systemUser = createSystemUser(admin.tenantId, ["Admin"]);
    const err = await stack.http.writeErr(
      CREATE_QN,
      { label: "bad id", id: "not-a-uuid" },
      systemUser,
    );
    expect(err.code).toBe("validation_error");
  });
});
