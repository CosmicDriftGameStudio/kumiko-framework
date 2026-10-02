// The generic list handler wires `registry.getSortableReferences` into the
// executor at request time. The executor tests hand-build the descriptor, so
// only this HTTP path catches a broken wiring (e.g. a wrong bare-vs-qualified
// entity name for a cross-feature reference).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { buildEntityTable } from "../../db/table-builder.js";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "../../stack/index.js";
import { seedRows } from "../../testing/index.js";
import { defineFeature } from "../define-feature.js";
import { defineEntityListHandler } from "../entity-handlers.js";
import { createEntity, createTextField } from "../factories.js";

const admin = TestUsers.admin;

const personEntity = createEntity({
  table: "list_ref_sort_people",
  fields: { name: createTextField({ required: true, personal: false, reason: "test_fixture" }) },
});
const personTable = buildEntityTable("person", personEntity);

const ticketEntity = createEntity({
  table: "list_ref_sort_tickets",
  fields: {
    note: createTextField({ personal: false, reason: "test_fixture" }),
    ownerId: {
      type: "reference",
      entity: "listrefsortpeople:person",
      labelField: "name",
      sortable: true,
    },
    plainOwnerId: {
      type: "reference",
      entity: "listrefsortpeople:person",
      labelField: "name",
    },
  },
});
const ticketTable = buildEntityTable("ticket", ticketEntity);

const peopleFeature = defineFeature("listrefsortpeople", (r) => {
  r.entity("person", personEntity);
});

const ticketFeature = defineFeature("listrefsort", (r) => {
  r.requires("listrefsortpeople");
  r.entity("ticket", ticketEntity);
  r.queryHandler(defineEntityListHandler("ticket", ticketEntity, { access: { roles: ["Admin"] } }));
});

// Own ids ascend a < b < c; the owner labels sort Alpha < Mike < Zulu while the
// owner UUIDs sort Mike < Alpha < Zulu, so the three orderings are pairwise different.
const PERSON_MIKE = "11111111-1111-4111-8111-111111111111";
const PERSON_ALPHA = "22222222-2222-4222-8222-222222222222";
const PERSON_ZULU = "33333333-3333-4333-8333-333333333333";
const TICKET_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TICKET_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TICKET_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [peopleFeature, ticketFeature] });
  await unsafeCreateEntityTable(stack.db, personEntity, "person");
  await unsafeCreateEntityTable(stack.db, ticketEntity, "ticket");
  await seedRows(stack.db, personTable, [
    { id: PERSON_MIKE, tenantId: admin.tenantId, name: "Mike" },
    { id: PERSON_ALPHA, tenantId: admin.tenantId, name: "Alpha" },
    { id: PERSON_ZULU, tenantId: admin.tenantId, name: "Zulu" },
  ]);
  await seedRows(stack.db, ticketTable, [
    {
      id: TICKET_A,
      tenantId: admin.tenantId,
      note: "a",
      ownerId: PERSON_ZULU,
      plainOwnerId: PERSON_ZULU,
    },
    {
      id: TICKET_B,
      tenantId: admin.tenantId,
      note: "b",
      ownerId: PERSON_MIKE,
      plainOwnerId: PERSON_MIKE,
    },
    {
      id: TICKET_C,
      tenantId: admin.tenantId,
      note: "c",
      ownerId: PERSON_ALPHA,
      plainOwnerId: PERSON_ALPHA,
    },
  ]);
});

afterAll(async () => {
  await stack.cleanup();
});

async function listIds(sort: string): Promise<unknown[]> {
  const { rows } = await stack.http.queryOk<{ rows: readonly Record<string, unknown>[] }>(
    "listrefsort:query:ticket:list",
    { sort },
    admin,
  );
  return rows.map((row) => row["id"]);
}

describe("generic list handler: reference sort wiring", () => {
  test("sort on a sortable cross-feature reference orders by the target label", async () => {
    expect(await listIds("ownerId")).toEqual([TICKET_C, TICKET_B, TICKET_A]);
  });

  test("sort on a non-sortable reference falls back to id order", async () => {
    expect(await listIds("plainOwnerId")).toEqual([TICKET_A, TICKET_B, TICKET_C]);
  });
});
