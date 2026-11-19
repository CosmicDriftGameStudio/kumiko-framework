import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { seedRowViaEventStore } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { Routes } from "../../api/api-constants.ts";
import { buildEntityTable } from "../../db/table-builder.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { defineFeature } from "../define-feature.ts";
import {
  createEntity,
  createMoneyField,
  createReferenceField,
  createTextField,
} from "../factories.ts";

const listingEntity = createEntity({
  name: "listing",
  table: "rlss_listings",
  fields: {
    title: createTextField({ required: true, personal: false, reason: "test_fixture" }),
  },
});

const offerEntity = createEntity({
  name: "offer",
  table: "rlss_offers",
  fields: {
    listingId: createReferenceField({
      entity: "listing",
      required: true,
      personal: false,
      reason: "test_fixture",
    }),
    bidder: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    amount: createMoneyField({ required: true }),
  },
});

const access = { roles: ["User"] };

const offerFeature = defineFeature("rlss", (r) => {
  r.crud(listingEntity, { write: { access }, read: { access } });
  r.crud(offerEntity, { write: { access }, read: { access } });
  r.screen({
    id: "listing-detail",
    type: "projectionDetail",
    query: "rlss:query:listing:detail",
    layout: {
      sections: [
        {
          id: "offers",
          kind: "relatedList",
          title: "Offers",
          query: "rlss:query:offer:list",
          entity: "offer",
          parentFilter: { field: "listingId" },
          pageSize: 3,
          columns: [
            "bidder",
            { field: "amount", sortable: true },
            { field: "listingId", sortable: true },
          ],
        },
      ],
    },
  });
});

const LIST = "rlss:query:offer:list";
const LISTING = "0b6c3f9e-5d1a-4c47-9e0a-2f1d7c4b8a10";
const OTHER_LISTING = "7d2e8a41-1f3b-4b6c-8d9e-0a5c2b7f3e21";

// Apps mint offer ids with crypto.randomUUID() (v4), so the id order is not
// the order the offers came in: seeded here in descending id order.
const offers = [
  { id: "f3a91c2e-8b47-4d15-9c6a-1e2f3a4b5c61", bidder: "Hofmann", amount: 412000 },
  { id: "d81b5e7a-2c94-4f36-8a1d-6b7c8d9e0f12", bidder: "Yilmaz", amount: 389500 },
  { id: "b4c27f19-6e3a-4d58-9b0c-3d4e5f6a7b83", bidder: "Schneider", amount: 455000 },
  { id: "92e6d3b8-4a71-4c29-8e5f-7a8b9c0d1e24", bidder: "Nowak", amount: 401250 },
  { id: "6f1a8c4d-9b25-4e63-a7d0-5e6f7a8b9c35", bidder: "Rossi", amount: 398000 },
  { id: "2a7e9b5c-3d16-4f84-b2c9-8d9e0f1a2b46", bidder: "Fischer", amount: 470000 },
];

type OfferRow = { readonly bidder: string; readonly amount: { readonly amount: number } };
type OfferPage = { readonly rows: readonly OfferRow[]; readonly nextCursor: string | null };
type SchemaSection = { readonly id?: string; readonly serverSortFields?: readonly string[] };
type SchemaBody = {
  readonly features: readonly {
    readonly featureName: string;
    readonly screens: readonly {
      readonly id: string;
      readonly layout?: { readonly sections: readonly SchemaSection[] };
    }[];
  }[];
};

describe("relatedList sort runs on the server", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({ features: [offerFeature] });
    await unsafeCreateEntityTable(stack.db, listingEntity);
    await unsafeCreateEntityTable(stack.db, offerEntity);
    const tenantId = TestUsers.user.tenantId;
    const listingTable = buildEntityTable(listingEntity);
    await seedRowViaEventStore(stack.db, listingTable, {
      id: LISTING,
      tenantId,
      title: "Altbauwohnung Lindenstraße 12",
    });
    await seedRowViaEventStore(stack.db, listingTable, {
      id: OTHER_LISTING,
      tenantId,
      title: "Reihenhaus Am Mühlbach 3",
    });
    const offerTable = buildEntityTable(offerEntity);
    for (const offer of offers) {
      await seedRowViaEventStore(stack.db, offerTable, {
        id: offer.id,
        tenantId,
        listingId: LISTING,
        bidder: offer.bidder,
        amount: { amount: offer.amount, currency: "EUR" },
      });
    }
    await seedRowViaEventStore(stack.db, offerTable, {
      tenantId,
      listingId: OTHER_LISTING,
      bidder: "Wagner",
      amount: { amount: 1000, currency: "EUR" },
    });
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  async function offersSection(): Promise<SchemaSection | undefined> {
    const token = await stack.jwt.sign(TestUsers.user);
    const res = await stack.app.request(`/api${Routes.schema}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json()) as SchemaBody;
    return body.features
      .find((f) => f.featureName === "rlss")
      ?.screens.find((s) => s.id === "listing-detail")
      ?.layout?.sections.find((s) => s.id === "offers");
  }

  // The payload the section sends: parent pin, page size, then the sort.
  function firstPage(sort: Record<string, unknown>, cursor?: string): Promise<OfferPage> {
    return stack.http.queryOk<OfferPage>(
      LIST,
      {
        filter: { field: "listingId", op: "eq", value: LISTING },
        limit: 3,
        ...sort,
        ...(cursor !== undefined && { cursor }),
      },
      TestUsers.user,
    );
  }

  test("the served schema names the columns the query sorts, and no reference without a label sort", async () => {
    const section = await offersSection();
    expect(section?.serverSortFields).toEqual(["amount", "insertedAt"]);
  });

  test("ascending by a money amount, the first page holds the smallest amounts", async () => {
    const page = await firstPage({ sort: "amount", sortDirection: "asc" });
    expect(page.rows.map((row) => row.amount.amount)).toEqual([389500, 398000, 401250]);
    expect(page.nextCursor).not.toBeNull();
  });

  test("descending by a money amount, the first page holds the largest amounts", async () => {
    const page = await firstPage({ sort: "amount", sortDirection: "desc" });
    expect(page.rows.map((row) => row.amount.amount)).toEqual([470000, 455000, 412000]);
  });

  test("without a column sort, insertedAt keeps the order the offers came in across pages", async () => {
    const sort = { sort: "insertedAt", sortDirection: "asc" };
    const page = await firstPage(sort);
    expect(page.rows.map((row) => row.bidder)).toEqual(["Hofmann", "Yilmaz", "Schneider"]);
    expect(page.nextCursor).not.toBeNull();
    const next = await firstPage(sort, page.nextCursor ?? undefined);
    expect([...page.rows, ...next.rows].map((row) => row.bidder)).toEqual(
      offers.map((offer) => offer.bidder),
    );
  });
});
