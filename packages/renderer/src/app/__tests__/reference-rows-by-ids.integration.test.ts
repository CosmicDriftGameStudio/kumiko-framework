import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateToken } from "@cosmicdrift/kumiko-framework/api";
import {
  createEntity,
  createTextField,
  defineFeature,
  from,
} from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { REFERENCE_COMBOBOX_LIMIT } from "../../hooks/reference-limits.ts";
import {
  referenceLookupSource,
  referenceRowsByIdsPayload,
} from "../../hooks/use-reference-lookup.ts";
import { createLiveDispatcher } from "../../live/index.ts";

type LabelRows = { readonly rows: ReadonlyArray<Record<string, unknown>> };

// Members read only the properties they manage, so a by-id lookup must not reveal a foreign one.
const propertyEntity = createEntity({
  table: "read_ref_lookup_properties",
  fields: {
    name: createTextField({ personal: false, reason: "test_fixture", required: true }),
    managerId: createTextField({ personal: "ref" }),
  },
  access: {
    read: { Admin: "all", Member: from("user:id", "managerId") },
    write: { Admin: "all" },
  },
});

const propertyFeature = defineFeature("ref-lookup", (r) => {
  const propertyAccess = { access: { roles: ["Admin", "Member"] } } as const;
  r.crud("property", propertyEntity, { write: propertyAccess, read: propertyAccess });
});

const member = createTestUser({
  id: "44444444-0000-4000-8000-000000000001",
  roles: ["Member"],
});
const otherManagerId = "44444444-0000-4000-8000-000000000002";
const MANAGED_PROPERTY_COUNT = REFERENCE_COMBOBOX_LIMIT + 10;

const { queryQn: propertyListQn } = referenceLookupSource("ref-lookup", "property", "name");

let stack: TestStack;
let foreignPropertyId: string;

beforeAll(async () => {
  stack = await setupTestStack({ features: [propertyFeature] });
  await unsafeCreateEntityTable(stack.db, propertyEntity, "property");
  for (let index = 1; index <= MANAGED_PROPERTY_COUNT; index++) {
    await stack.http.writeOk(
      "ref-lookup:write:property:create",
      { name: `Property ${index}`, managerId: member.id },
      TestUsers.admin,
    );
  }
  const foreign = await stack.http.writeOk<{ id: string }>(
    "ref-lookup:write:property:create",
    { name: "Foreign property", managerId: otherManagerId },
    TestUsers.admin,
  );
  foreignPropertyId = foreign.id;
});

afterAll(async () => {
  await stack.cleanup();
});

async function memberDispatcher() {
  const csrfToken = generateToken();
  const cookieHeader = `kumiko_auth=${await stack.jwt.sign(member)}; kumiko_csrf=${csrfToken}`;
  // fetch also carries preconnect, a hint the in-memory app has no use for; the real one keeps the type whole.
  const fetchThroughApp = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) =>
      stack.app.request(String(input), {
        ...init,
        headers: { ...init?.headers, Cookie: cookieHeader },
      }),
    { preconnect: fetch.preconnect },
  );
  return createLiveDispatcher({ fetch: fetchThroughApp, readCsrf: () => csrfToken });
}

async function queryLabelRows(payload: Record<string, unknown>): Promise<LabelRows> {
  const dispatcher = await memberDispatcher();
  const result = await dispatcher.query<LabelRows>(propertyListQn, payload);
  if (!result.isSuccess) throw new Error(`${propertyListQn} failed: ${JSON.stringify(result)}`);
  return result.data;
}

describe("reference label lookup by id over /api/query", () => {
  test("resolves a stored id that the capped first page does not contain", async () => {
    const cappedPage = await queryLabelRows({ limit: REFERENCE_COMBOBOX_LIMIT });
    const cappedIds = new Set(cappedPage.rows.map((row) => String(row["id"])));
    const allManaged = await queryLabelRows({ limit: MANAGED_PROPERTY_COUNT });
    const beyondCap = allManaged.rows.find((row) => !cappedIds.has(String(row["id"])));
    if (beyondCap === undefined) throw new Error("expected a managed property beyond the cap");
    const beyondCapId = String(beyondCap["id"]);

    const byId = await queryLabelRows(
      referenceRowsByIdsPayload([beyondCapId], REFERENCE_COMBOBOX_LIMIT),
    );

    expect(byId.rows.map((row) => [row["id"], row["name"]])).toEqual([
      [beyondCapId, beyondCap["name"]],
    ]);
  });

  test("an id the caller may not read yields no row and no label", async () => {
    const byId = await queryLabelRows(
      referenceRowsByIdsPayload([foreignPropertyId], REFERENCE_COMBOBOX_LIMIT),
    );

    expect(byId.rows).toEqual([]);
  });
});
