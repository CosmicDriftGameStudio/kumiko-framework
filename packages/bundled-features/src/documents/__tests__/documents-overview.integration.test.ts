// The documents list query: per-row expiry state and the moving "expiring" filter, both
// behind the same read gate as the plain list. The clock is fixed at 2026-06-15.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { DocumentsQueries } from "../constants.ts";
import {
  IMPORT_JOB,
  seedLease,
  seedProperty,
  setupDocumentStack,
  tenant,
  users,
  visibleDocuments,
} from "./fixtures.ts";

const OVERVIEW = DocumentsQueries.overview;
const EXPIRING_FILTER = { field: "expiry", op: "in", value: ["expiring"] };

type OverviewRow = { id: string; title: string; validUntil?: string | null; expiry: string };
type OverviewPage = { rows: readonly OverviewRow[]; total?: number };

let stack: TestStack;
let propertyId: string;

beforeAll(async () => {
  stack = await setupDocumentStack();
  propertyId = await seedProperty(stack, "Main street 1");
  const dates = ["2026-06-14", "2026-06-15", "2026-07-15", "2026-07-16", undefined];
  for (const [index, validUntil] of dates.entries()) {
    await stack.jobRunner?.dispatch(IMPORT_JOB, {
      tenantId: tenant,
      propertyId,
      id: `5c000000-0000-4000-8000-00000000000${index}`,
      validUntil,
    });
    await stack.drainJobs();
  }
});
afterAll(() => stack.cleanup());

function overview(as: typeof users.admin, payload: Record<string, unknown> = {}) {
  return stack.http.queryOk<OverviewPage>(
    OVERVIEW,
    { limit: 100, totalCount: true, ...payload },
    as,
  );
}

const expiryByDate = (page: OverviewPage) =>
  Object.fromEntries(page.rows.map((row) => [row.validUntil ?? "none", row.expiry]));

describe("documents overview", () => {
  test("each row carries its expiry state, with the boundary days on the expiring side", async () => {
    const page = await overview(users.propertyReader);
    expect(page.total).toBe(5);
    expect(expiryByDate(page)).toEqual({
      "2026-06-14": "expired",
      "2026-06-15": "expiring",
      "2026-07-15": "expiring",
      "2026-07-16": "valid",
      none: "none",
    });
  });

  test("the expiring filter returns exactly the expired and the expiring documents", async () => {
    const page = await overview(users.propertyReader, { filters: [EXPIRING_FILTER] });
    expect(page.total).toBe(3);
    expect(page.rows.map((row) => row.expiry).sort()).toEqual(["expired", "expiring", "expiring"]);
  });

  test("other filter clauses pass through next to the expiring filter", async () => {
    const page = await overview(users.propertyReader, {
      filters: [EXPIRING_FILTER, { field: "validUntil", op: "gte", value: "2026-06-15" }],
    });
    expect(Object.keys(expiryByDate(page)).sort()).toEqual(["2026-06-15", "2026-07-15"]);
  });

  test("a document behind a host or file owner the role cannot read never appears", async () => {
    await seedLease(stack, propertyId, { name: "Hidden" });
    const hidden = (
      await stack.http.queryOk<{ rows: readonly { id: string; version: number }[] }>(
        "documents:query:filed-document:list",
        { filters: [{ field: "title", op: "eq", value: "Lease Hidden" }] },
        users.admin,
      )
    ).rows[0];
    if (hidden === undefined) throw new Error("expected the captured lease document");
    await stack.http.writeOk(
      "documents:write:filed-document:update",
      { id: hidden.id, version: hidden.version, changes: { validUntil: "2026-06-01" } },
      users.admin,
    );

    for (const payload of [{}, { filters: [EXPIRING_FILTER] }]) {
      expect(
        (await overview(users.propertyReader, payload)).rows.map((row) => row.title),
      ).not.toContain("Lease Hidden");
      expect((await overview(users.nobody, payload)).rows).toEqual([]);
    }
    const asAdmin = await overview(users.admin, { filters: [EXPIRING_FILTER] });
    expect(asAdmin.rows.map((row) => row.title)).toContain("Lease Hidden");
    expect((await visibleDocuments(stack, users.propertyReader)).total).toBe(5);
  });
});
