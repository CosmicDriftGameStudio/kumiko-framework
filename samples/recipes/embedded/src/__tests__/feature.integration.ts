// Embedded Object Sample — Integration Test
// Proves: embedded objects stored as JSONB, read back correctly,
// required embedded fails when missing, optional embedded can be omitted,
// searchable sub-fields registered, field access on sub-fields E2E

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { contactEntity } from "../entities/contact";
import { embeddedFeature } from "../feature";

let stack: TestStack;

const admin = TestUsers.admin;
const viewer = createTestUser({ id: 2, roles: ["Viewer"] });
const otherTenant = createTestUser({ id: 3, tenantId: "00000000-0000-4000-8000-000000000002" });

beforeAll(async () => {
  stack = await setupTestStack({
    features: [embeddedFeature],
    systemHooks: [],
  });
  await unsafeCreateEntityTable(stack.db, contactEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

// --- Create + Read ---

describe("create and read embedded objects", () => {
  test("create contact with required address succeeds", async () => {
    const data = await stack.http.writeOk(
      "contacts:write:contact:create",
      {
        name: "Max Mustermann",
        email: "max@test.de",
        address: { street: "Hauptstr. 1", zip: "10115", city: "Berlin", country: "DE" },
      },
      admin,
    );
    expect(data.isNew).toBe(true);
    expect(data.data["address"]).toEqual({
      street: "Hauptstr. 1",
      zip: "10115",
      city: "Berlin",
      country: "DE",
    });
  });

  test("detail returns embedded object intact", async () => {
    const created = await stack.http.writeOk(
      "contacts:write:contact:create",
      {
        name: "Detail Test",
        address: { street: "Musterweg 5", zip: "80331", city: "München" },
      },
      admin,
    );

    const detail = await stack.http.queryOk<Record<string, unknown>>(
      "contacts:query:contact:detail",
      { id: created.id },
      admin,
    );
    expect(detail["name"]).toBe("Detail Test");
    const addr = detail["address"];
    expect(addr["street"]).toBe("Musterweg 5");
    expect(addr["city"]).toBe("München");
  });

  test("create with optional billingAddress", async () => {
    const data = await stack.http.writeOk(
      "contacts:write:contact:create",
      {
        name: "With Billing",
        address: { street: "A-Str.", zip: "12345", city: "Hamburg" },
        billingAddress: {
          street: "B-Str.",
          zip: "54321",
          city: "Frankfurt",
          vatId: "DE123456789",
        },
      },
      admin,
    );
    expect(data.isNew).toBe(true);
    const billing = data.data["billingAddress"];
    expect(billing["vatId"]).toBe("DE123456789");
  });

  test("create without optional billingAddress succeeds", async () => {
    const data = await stack.http.writeOk(
      "contacts:write:contact:create",
      {
        name: "No Billing",
        address: { street: "C-Str.", zip: "11111", city: "Köln" },
      },
      admin,
    );
    expect(data.isNew).toBe(true);
  });
});

// --- Validation ---

describe("embedded validation", () => {
  test("missing required address fails", async () => {
    const error = await stack.http.writeErr(
      "contacts:write:contact:create",
      { name: "No Address" },
      admin,
    );
    expect(error).toBeDefined();
  });

  test("address with missing required sub-field fails", async () => {
    const error = await stack.http.writeErr(
      "contacts:write:contact:create",
      {
        name: "Bad Address",
        address: { street: "Only Street" }, // missing zip + city
      },
      admin,
    );
    expect(error).toBeDefined();
  });
});

// --- Field access on embedded sub-fields (E2E via API) ---

describe("field access on embedded sub-fields", () => {
  let contactWithBillingId: number;

  test("create contact with billingAddress for access tests", async () => {
    const created = await stack.http.writeOk(
      "contacts:write:contact:create",
      {
        name: "Access Test Contact",
        address: { street: "A", zip: "1", city: "X" },
        billingAddress: { street: "B", zip: "2", city: "Y", vatId: "DE999" },
      },
      admin,
    );
    contactWithBillingId = created.id;
  });

  test("Admin sees billingAddress.vatId via detail query", async () => {
    const detail = await stack.http.queryOk<Record<string, unknown>>(
      "contacts:query:contact:detail",
      { id: contactWithBillingId },
      admin,
    );
    const billing = detail["billingAddress"];
    expect(billing["vatId"]).toBe("DE999");
    expect(billing["street"]).toBe("B");
  });

  test("Viewer does NOT see billingAddress.vatId via detail query", async () => {
    const detail = await stack.http.queryOk<Record<string, unknown>>(
      "contacts:query:contact:detail",
      { id: contactWithBillingId },
      viewer,
    );
    const billing = detail["billingAddress"];
    expect(billing["vatId"]).toBeUndefined();
    expect(billing["street"]).toBe("B"); // other fields still visible
  });
});

// --- Searchable embedded sub-fields (registry) ---

describe("searchable embedded sub-fields", () => {
  test("registry reports embedded sub-fields as searchable", () => {
    const searchable = stack.registry.getSearchableFields("contact");
    expect(searchable).toContain("name");
    expect(searchable).toContain("address_street");
    expect(searchable).toContain("address_city");
    expect(searchable).not.toContain("address_zip"); // not marked searchable
    expect(searchable).not.toContain("address_country");
  });
});

// --- Tenant isolation ---

describe("tenant isolation", () => {
  test("other tenant cannot read contact", async () => {
    const created = await stack.http.writeOk(
      "contacts:write:contact:create",
      {
        name: "Secret Contact",
        address: { street: "Hidden", zip: "00000", city: "Nowhere" },
      },
      admin,
    );

    const detail = await stack.http.queryOk<null>(
      "contacts:query:contact:detail",
      { id: created.id },
      otherTenant,
    );
    expect(detail).toBeNull();
  });
});
