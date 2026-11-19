// Money and located timestamps store companion columns (<name>Currency,
// <name>Utc, <name>Tz) that are no declared field. A caller who cannot read the
// declared field must not probe its value through a sort or filter on such a
// column either: row order and match counts would leak what the row strips.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { defineFeature } from "../../engine/define-feature.ts";
import {
  createEntity,
  createLocatedTimestampField,
  createMoneyField,
  createTextField,
} from "../../engine/factories.ts";
import { eventsTable } from "../../event-store/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";

const offerEntity = createEntity({
  name: "offer",
  table: "fa_companion_offers",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
    price: createMoneyField({ access: { read: { Admin: "all" } } }),
    closesAt: createLocatedTimestampField({ access: { read: { Admin: "all" } } }),
  },
});

const LIST_QN = "companionoffers:query:offer:list";
const CREATE = "companionoffers:write:offer:create";

const companionOffersFeature = defineFeature("companionoffers", (r) => {
  r.crud(offerEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: { openToAll: { reason: "test handler callable by any signed-in test user" } } },
  });
});

type OfferRow = { readonly id: string; readonly title: string };
type ListResult = { readonly rows: readonly OfferRow[]; readonly total?: number };

describe("list() gates companion columns by the declared field's read access", () => {
  let stack: TestStack;
  let first: { id: string };
  let second: { id: string };

  beforeAll(async () => {
    stack = await setupTestStack({ features: [companionOffersFeature] });
    await unsafeCreateEntityTable(stack.db, offerEntity);
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  beforeEach(async () => {
    await resetTestTables(stack.db, [eventsTable, "fa_companion_offers"]);
    // id order is [first, second]; every DESC sort below reverses it, so an
    // applied sort and a dropped one are told apart.
    first = await stack.http.writeOk<{ id: string }>(
      CREATE,
      {
        title: "First",
        price: { amount: 100, currency: "EUR" },
        closesAt: { at: "2026-01-02T03:04:05", tz: "Europe/Berlin" },
      },
      TestUsers.admin,
    );
    second = await stack.http.writeOk<{ id: string }>(
      CREATE,
      {
        title: "Second",
        price: { amount: 100, currency: "USD" },
        closesAt: { at: "2026-06-02T03:04:05", tz: "Pacific/Auckland" },
      },
      TestUsers.admin,
    );
  });

  async function idsSortedBy(
    sort: string,
    user: typeof TestUsers.user | typeof TestUsers.admin,
  ): Promise<string[]> {
    const result = await stack.http.queryOk<ListResult>(
      LIST_QN,
      { limit: 50, sort, sortDirection: "desc" },
      user,
    );
    return result.rows.map((row) => row.id);
  }

  test("a sort on a companion column of an unreadable field falls back to id order", async () => {
    for (const column of ["priceCurrency", "closesAtUtc", "closesAtTz"]) {
      expect(await idsSortedBy(column, TestUsers.user)).toEqual([first.id, second.id]);
    }
  });

  test("a caller who can read the field still sorts by its companion column", async () => {
    for (const column of ["priceCurrency", "closesAtUtc", "closesAtTz"]) {
      expect(await idsSortedBy(column, TestUsers.admin)).toEqual([second.id, first.id]);
    }
  });

  test("a filter on a companion column of an unreadable field matches nothing", async () => {
    const asUser = await stack.http.queryOk<ListResult>(
      LIST_QN,
      { limit: 50, totalCount: true, filter: { field: "priceCurrency", op: "eq", value: "USD" } },
      TestUsers.user,
    );
    expect(asUser.rows).toHaveLength(0);
    expect(asUser.total).toBe(0);

    const asAdmin = await stack.http.queryOk<ListResult>(
      LIST_QN,
      { limit: 50, totalCount: true, filter: { field: "priceCurrency", op: "eq", value: "USD" } },
      TestUsers.admin,
    );
    expect(asAdmin.rows.map((row) => row.id)).toEqual([second.id]);
  });
});
