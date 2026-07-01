// 225/2: der sicherheitskritische WHERE-Merge (caller-`where.tenantId`
// darf den Tenant-Scope nur NARROWEN, nie erweitern) — hier gegen echtes
// Postgres über den vollen HTTP-Pfad (setupTestStack), nicht nur als
// SQL-String-Pin gegen den recording-Fake (tenant-db-where-merge.test.ts
// bleibt als Schnell-Pin bestehen).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { updateRows } from "@cosmicdrift/kumiko-framework/testing";
import { z } from "zod";
import { selectMany } from "../../bun-db";
import {
  createEntity,
  createTextField,
  defineEntityCreateHandler,
  defineFeature,
} from "../../engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "../../stack";
import { buildEntityTable } from "../table-builder";

const noteEntity = createEntity({
  fields: {
    title: createTextField({ required: true }),
  },
  table: "where_merge_notes",
});
const noteTable = buildEntityTable("note", noteEntity);

// Die Handler reichen eine CALLER-KONTROLLIERTE where.tenantId in die
// TenantDb — genau der Angriffsvektor, den der Merge neutralisieren muss.
const probeFeature = defineFeature("where-merge-probe", (r) => {
  r.entity("note", noteEntity);
  r.writeHandler(defineEntityCreateHandler("note", noteEntity, { access: { roles: ["User"] } }));

  r.queryHandler({
    name: "list-for-tenant",
    schema: z.object({ tenantId: z.string() }),
    access: { roles: ["User"] },
    handler: async (query, ctx) => {
      const rows = await selectMany(ctx.db, noteTable, {
        tenantId: query.payload.tenantId,
      });
      return rows.map((row) => ({ title: row["title"], tenantId: row["tenantId"] }));
    },
  });

  r.writeHandler({
    name: "retitle-for-tenant",
    schema: z.object({ tenantId: z.string(), title: z.string() }),
    access: { roles: ["User"] },
    handler: async (event, ctx) => {
      const count = await updateRows(
        ctx.db,
        noteTable,
        { tenantId: event.payload.tenantId },
        { title: event.payload.title },
      );
      return { isSuccess: true as const, data: { count } };
    },
  });
});

let stack: TestStack;

const tenantA = testTenantId(81);
const tenantB = testTenantId(82);
const userA = createTestUser({ id: 81, tenantId: tenantA, roles: ["User"] });
const userB = createTestUser({ id: 82, tenantId: tenantB, roles: ["User"] });

beforeAll(async () => {
  stack = await setupTestStack({ features: [probeFeature] });
  await unsafeCreateEntityTable(stack.db, noteEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("tenant-db WHERE merge — full stack", () => {
  test("foreign where.tenantId in a query never returns the other tenant's rows", async () => {
    await stack.http.writeOk("where-merge-probe:write:note:create", { title: "a-note" }, userA);
    await stack.http.writeOk("where-merge-probe:write:note:create", { title: "b-note" }, userB);

    // userA fragt EXPLIZIT nach tenantB — der Merge IGNORIERT die fremde
    // tenantId (fällt auf den eigenen Scope zurück): nie b-note, die
    // fremde Row bleibt unsichtbar.
    const crossRead = (await stack.http.queryOk(
      "where-merge-probe:query:list-for-tenant",
      { tenantId: tenantB },
      userA,
    )) as Array<{ title: string; tenantId: string }>;
    expect(crossRead.map((r) => r.title)).not.toContain("b-note");
    expect(crossRead.every((r) => r.tenantId === tenantA)).toBe(true);

    // Kontrolle: der eigene Tenant ist über denselben Pfad lesbar.
    const ownRead = (await stack.http.queryOk(
      "where-merge-probe:query:list-for-tenant",
      { tenantId: tenantA },
      userA,
    )) as Array<{ title: string }>;
    expect(ownRead.map((r) => r.title)).toEqual(["a-note"]);
  });

  test("foreign where.tenantId in an update never touches the other tenant's rows", async () => {
    await stack.http.writeOk(
      "where-merge-probe:write:retitle-for-tenant",
      { tenantId: tenantB, title: "HACKED" },
      userA,
    );

    const bRows = (await stack.http.queryOk(
      "where-merge-probe:query:list-for-tenant",
      { tenantId: tenantB },
      userB,
    )) as Array<{ title: string }>;
    expect(bRows.map((r) => r.title)).toEqual(["b-note"]);
  });
});
