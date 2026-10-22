// Tenant Isolation Sample — Integration Test
// Proves: tenant_id scopes all data, cross-tenant access returns nothing

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import type { SaveContext } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser, TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { noteEntity, noteFeature, preferenceTable } from "../feature";

let stack: TestStack;

const tenantAAdmin = TestUsers.admin;
const tenantBAdmin = createTestUser({ id: 2, tenantId: "00000000-0000-4000-8000-000000000002" });

beforeAll(async () => {
  stack = await setupTestStack({ features: [noteFeature] });
  await unsafeCreateEntityTable(stack.db, noteEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(() => {
  stack.events.reset();
});

describe("tenant isolation", () => {
  test("tenant A cannot see tenant B's data via detail", async () => {
    const noteA = await stack.http.writeOk<SaveContext>(
      "notes:write:note:create",
      {
        title: "Tenant A secret",
        content: "Confidential",
      },
      tenantAAdmin,
    );

    // Tenant B tries to read Tenant A's note
    const detail = await stack.http.queryOk<null>(
      "notes:query:note:detail",
      { id: noteA.id },
      tenantBAdmin,
    );

    expect(detail).toBeNull();
  });

  test("tenant B cannot see tenant A's data in list", async () => {
    await stack.http.writeOk<SaveContext>(
      "notes:write:note:create",
      {
        title: "Only-For-A",
      },
      tenantAAdmin,
    );

    // Tenant B lists — should not see Tenant A's notes
    const listB = await stack.http.queryOk<{ rows: Record<string, unknown>[] }>(
      "notes:query:note:list",
      {},
      tenantBAdmin,
    );

    expect(listB.rows.some((r) => r["title"] === "Only-For-A")).toBe(false);
  });

  test("each tenant sees only their own data", async () => {
    await stack.http.writeOk<SaveContext>(
      "notes:write:note:create",
      { title: "A-Note" },
      tenantAAdmin,
    );
    await stack.http.writeOk<SaveContext>(
      "notes:write:note:create",
      { title: "B-Note" },
      tenantBAdmin,
    );

    const listA = await stack.http.queryOk<{ rows: Record<string, unknown>[] }>(
      "notes:query:note:list",
      {},
      tenantAAdmin,
    );
    const listB = await stack.http.queryOk<{ rows: Record<string, unknown>[] }>(
      "notes:query:note:list",
      {},
      tenantBAdmin,
    );

    expect(listA.rows.some((r) => r["title"] === "A-Note")).toBe(true);
    expect(listA.rows.some((r) => r["title"] === "B-Note")).toBe(false);

    expect(listB.rows.some((r) => r["title"] === "B-Note")).toBe(true);
    expect(listB.rows.some((r) => r["title"] === "A-Note")).toBe(false);
  });
});

describe("ctx.db.upsert", () => {
  const setPreference = (user: typeof tenantBAdmin, key: string, value: string) =>
    stack.http.writeOk<{ value: string }>("notes:write:preference:set", { key, value }, user);

  test("a second upsert with the same key updates the tenant's row instead of inserting", async () => {
    await setPreference(tenantAAdmin, "theme", "light");
    const second = await setPreference(tenantAAdmin, "theme", "dark");

    expect(second.value).toBe("dark");
    const rows = await selectMany(stack.db, preferenceTable, {
      tenantId: tenantAAdmin.tenantId,
      key: "theme",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["value"]).toBe("dark");
  });

  test("the same key in another tenant creates a separate row and leaves A's value alone", async () => {
    await setPreference(tenantAAdmin, "language", "de");
    await setPreference(tenantBAdmin, "language", "en");

    const rowsA = await selectMany(stack.db, preferenceTable, {
      tenantId: tenantAAdmin.tenantId,
      key: "language",
    });
    const rowsB = await selectMany(stack.db, preferenceTable, {
      tenantId: tenantBAdmin.tenantId,
      key: "language",
    });
    expect(rowsA.map((row) => row["value"])).toEqual(["de"]);
    expect(rowsB.map((row) => row["value"])).toEqual(["en"]);
  });
});
