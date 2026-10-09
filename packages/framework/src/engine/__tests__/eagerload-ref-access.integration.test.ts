// _refs must only carry what the caller could read on the target entity itself
// (access.read row scope, field-level read) — kumiko-framework#3617. Real HTTP
// calls + setupTestStack, never createTestDispatcher.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "../../stack/index.js";
import { createEntity, createTextField } from "../factories.js";
import { defineFeature } from "../index.js";
import type { EntityDefinition, SessionUser } from "../types/index.js";

const propertyAccess: NonNullable<EntityDefinition["access"]> = {
  read: {
    Admin: "all",
    TenantMember: {
      kind: "where",
      where: (user, ctx) => ({
        sqlText: `${ctx.tableName}.team_id = $${ctx.paramStart}`,
        params: [user.claims?.["team"] ?? null],
      }),
    },
  },
  write: { Admin: "all" },
};

const propertyEntity = createEntity({
  table: "elref_properties",
  fields: {
    name: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    teamId: createTextField({ required: true, personal: false, reason: "technical_reference" }),
    secretNote: createTextField({
      personal: false,
      reason: "test_fixture",
      access: { read: { Admin: "all" } },
    }),
  },
  access: propertyAccess,
});

const leaseEntity = createEntity({
  table: "elref_leases",
  fields: {
    label: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    propertyId: { type: "reference", entity: "property" },
    extraIds: { type: "reference", entity: "property", multiple: true },
  },
  access: { write: { Admin: "all" } },
});

const openRead = { access: { openToAll: { reason: "test handler callable by any test user" } } };

const feature = defineFeature("elref", (r) => {
  r.entity("property", propertyEntity);
  r.entity("lease", leaseEntity);
  r.crud("property", propertyEntity, { write: { access: { roles: ["Admin"] } }, read: openRead });
  r.crud("lease", leaseEntity, { write: { access: { roles: ["Admin"] } }, read: openRead });
});

const admin = TestUsers.admin;
const memberA = createTestUser({ id: 61, roles: ["TenantMember"], claims: { team: "team-a" } });
const memberB = createTestUser({ id: 62, roles: ["TenantMember"], claims: { team: "team-b" } });
const outsider = createTestUser({ id: 63, roles: ["Visitor"] });

type Refs = {
  readonly propertyId?: Record<string, unknown>;
  readonly extraIds?: ReadonlyArray<Record<string, unknown>>;
};
type LeaseRow = { readonly id: string; readonly label: string; readonly _refs?: Refs };

let stack: TestStack;
let propertyA: string;
let propertyB: string;
let leaseToA: string;
let leaseToB: string;

async function createProperty(name: string, teamId: string): Promise<string> {
  const res = await stack.http.writeOk<{ id: string }>(
    "elref:write:property:create",
    { name, teamId, secretNote: `note-${name}` },
    admin,
  );
  return res.id;
}

async function createLease(label: string, propertyId: string, extraIds: string[]): Promise<string> {
  const res = await stack.http.writeOk<{ id: string }>(
    "elref:write:lease:create",
    { label, propertyId, extraIds },
    admin,
  );
  return res.id;
}

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
  await unsafeCreateEntityTable(stack.db, propertyEntity, "property");
  await unsafeCreateEntityTable(stack.db, leaseEntity, "lease");
  propertyA = await createProperty("Alpha", "team-a");
  propertyB = await createProperty("Beta", "team-b");
  leaseToA = await createLease("to-a", propertyA, [propertyA, propertyB]);
  leaseToB = await createLease("to-b", propertyB, [propertyB, propertyA]);
});

afterAll(async () => {
  await stack.cleanup();
});

async function listLeases(user: SessionUser): Promise<Map<string, LeaseRow>> {
  const { rows } = await stack.http.queryOk<{ rows: readonly LeaseRow[] }>(
    "elref:query:lease:list",
    {},
    user,
  );
  return new Map(rows.map((row) => [row.id, row]));
}

async function detailLease(id: string, user: SessionUser): Promise<LeaseRow | null> {
  return stack.http.queryOk<LeaseRow | null>("elref:query:lease:detail", { id }, user);
}

describe("_refs respect the target entity's read access", () => {
  test("list: team A sees only the team-A target, without the admin-only field", async () => {
    const rows = await listLeases(memberA);
    const own = rows.get(leaseToA)?._refs;
    expect(own?.propertyId?.["name"]).toBe("Alpha");
    expect(own?.propertyId).not.toHaveProperty("secretNote");
    expect(own?.extraIds?.map((p) => p["name"])).toEqual(["Alpha"]);

    const foreign = rows.get(leaseToB)?._refs;
    expect(foreign?.propertyId).toBeUndefined();
    expect(foreign?.extraIds?.map((p) => p["name"])).toEqual(["Alpha"]);
  });

  test("detail: team B sees only the team-B target", async () => {
    const own = await detailLease(leaseToB, memberB);
    expect(own?._refs?.propertyId?.["name"]).toBe("Beta");
    expect(own?._refs?.extraIds?.map((p) => p["name"])).toEqual(["Beta"]);

    const foreign = await detailLease(leaseToA, memberB);
    expect(foreign?._refs?.propertyId).toBeUndefined();
    expect(foreign?._refs?.extraIds?.map((p) => p["name"])).toEqual(["Beta"]);
  });

  test("admin sees every target including the field-level secret", async () => {
    const row = await detailLease(leaseToA, admin);
    expect(row?._refs?.propertyId?.["secretNote"]).toBe("note-Alpha");
    expect(row?._refs?.extraIds?.map((p) => p["name"])).toEqual(["Alpha", "Beta"]);
  });

  test("a role absent from the target's access.read map gets no refs at all", async () => {
    const rows = await listLeases(outsider);
    const refs = rows.get(leaseToA)?._refs;
    expect(refs?.propertyId).toBeUndefined();
    expect(refs?.extraIds).toEqual([]);

    const row = await detailLease(leaseToA, outsider);
    expect(row?._refs?.propertyId).toBeUndefined();
  });
});
