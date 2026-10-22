import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { TestUsers } from "../../seeding/seed-users.ts";
import { defineFeature } from "../define-feature.ts";
import { createEntity, createTextField } from "../factories.ts";

const ATTENDEE_A = "11111111-1111-4111-8111-111111111111";
const ATTENDEE_B = "22222222-2222-4222-8222-222222222222";
const ATTENDEE_C = "33333333-3333-4333-8333-333333333333";

const protocolEntity = createEntity({
  table: "mr_filter_protocol",
  fields: {
    title: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    attendeeIds: { type: "reference", entity: "user", multiple: true },
  },
});

const LIST_QN = "meetings:query:protocol:list";
const CREATE_QN = "meetings:write:protocol:create";

const meetingsFeature = defineFeature("meetings", (r) => {
  r.crud("protocol", protocolEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: { openToAll: { reason: "test handler callable by any signed-in test user" } } },
  });
});

describe("multiple reference list filter — jsonb containment", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({ features: [meetingsFeature] });
    await unsafeCreateEntityTable(stack.db, protocolEntity);
    const create = (title: string, attendeeIds: string[]) =>
      stack.http.write(CREATE_QN, { title, attendeeIds }, TestUsers.admin);
    await create("Kickoff", [ATTENDEE_A, ATTENDEE_B]);
    await create("Review", [ATTENDEE_B]);
    await create("Solo", []);
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  async function titlesFor(filter: object): Promise<string[]> {
    const result = await stack.http.queryOk<{ readonly rows: readonly { title: string }[] }>(
      LIST_QN,
      { limit: 50, ...filter },
      TestUsers.admin,
    );
    return result.rows.map((row) => row.title).sort();
  }

  test("eq with one id returns only rows whose array contains it", async () => {
    expect(
      await titlesFor({ filter: { field: "attendeeIds", op: "eq", value: ATTENDEE_A } }),
    ).toEqual(["Kickoff"]);
    expect(
      await titlesFor({ filter: { field: "attendeeIds", op: "eq", value: ATTENDEE_B } }),
    ).toEqual(["Kickoff", "Review"]);
  });

  test("in returns rows containing any listed id", async () => {
    expect(
      await titlesFor({
        filters: [{ field: "attendeeIds", op: "in", value: [ATTENDEE_A, ATTENDEE_C] }],
      }),
    ).toEqual(["Kickoff"]);
  });

  test("ne returns rows that do not contain the id", async () => {
    expect(
      await titlesFor({ filter: { field: "attendeeIds", op: "ne", value: ATTENDEE_A } }),
    ).toEqual(["Review", "Solo"]);
  });
});
