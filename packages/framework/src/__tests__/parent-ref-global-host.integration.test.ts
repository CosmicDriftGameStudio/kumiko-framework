// A global host's rows carry the system tenant, which the tenant scope of a join row
// statement cannot read. Detail, list and the write-side row check still have to apply
// the host check (host access.read, host soft delete) to such hosts.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { expectErrorIncludes, seedRows } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import { buildEntityTable } from "../db/table-builder.ts";
import {
  createEntity,
  createTextField,
  defineEntityQueryHandler,
  defineEntityWriteHandler,
  defineFeature,
} from "../engine/index.ts";
import { SYSTEM_TENANT_ID } from "../engine/types/index.ts";
import { createTestUser } from "../seeding/seed-users.ts";

const hostAccess: NonNullable<EntityDefinition["access"]> = {
  read: {
    TenantMember: {
      kind: "where",
      where: (user, ctx) => ({
        sqlText: `${ctx.tableName}.team_id = $${ctx.paramStart}`,
        params: [user.claims?.["team"] ?? null],
      }),
    },
  },
};

const globalHostEntity = createEntity({
  table: "pr_global_hosts",
  tenancy: "global",
  softDelete: true,
  fields: {
    teamId: createTextField({ required: true, personal: false, reason: "technical_reference" }),
  },
  access: hostAccess,
});
const globalHostTable = buildEntityTable("globalHost", globalHostEntity);

const linkEntity = createEntity({
  table: "pr_global_links",
  softDelete: true,
  parentRef: { entityTypeField: "entityType", entityIdField: "entityId" },
  fields: {
    entityType: createTextField({ required: true, personal: false, reason: "technical_reference" }),
    entityId: createTextField({ required: true, personal: false, reason: "technical_reference" }),
    label: createTextField({ required: true, personal: false, reason: "test_fixture" }),
  },
});

const linkTable = buildEntityTable("link", linkEntity);

const feature = defineFeature("prglobal", (r) => {
  r.entity({ name: "globalHost", ...globalHostEntity });
  r.entity({ name: "link", ...linkEntity });
  for (const verb of ["create", "update"] as const) {
    r.writeHandler(
      defineEntityWriteHandler(`link:${verb}`, linkEntity, { access: { roles: ["TenantMember"] } }),
    );
  }
  for (const verb of ["detail", "list"] as const) {
    r.queryHandler(
      defineEntityQueryHandler(`link:${verb}`, linkEntity, { access: { roles: ["TenantMember"] } }),
    );
  }
});

const teamA = createTestUser({ id: 92, roles: ["TenantMember"], claims: { team: "team-a" } });
const teamB = createTestUser({ id: 93, roles: ["TenantMember"], claims: { team: "team-b" } });

const LIVE_HOST_ID = "e0000000-0000-4000-8000-00000000001a";
const DELETED_HOST_ID = "e0000000-0000-4000-8000-00000000001b";
const TRASHED_LINK_ID = "e0000000-0000-4000-8000-00000000001c";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
  await unsafeCreateEntityTable(stack.db, globalHostEntity, "globalHost");
  await unsafeCreateEntityTable(stack.db, linkEntity, "link");
  await seedRows(
    stack.db,
    globalHostTable,
    [
      { id: LIVE_HOST_ID, tenantId: SYSTEM_TENANT_ID, teamId: "team-a", isDeleted: false },
      { id: DELETED_HOST_ID, tenantId: SYSTEM_TENANT_ID, teamId: "team-a", isDeleted: true },
    ],
    { projectionOnly: "fixture plants a projection row without its event" },
  );
});

afterAll(async () => {
  await stack.cleanup();
});

async function createLink(hostId: string, label: string): Promise<{ id: string; version: number }> {
  const res = await stack.http.writeOk<{ id: string; data: { version: number } }>(
    "prglobal:write:link:create",
    { entityType: "globalHost", entityId: hostId, label },
    teamA,
  );
  return { id: res.id, version: res.data.version };
}

async function labelInDetail(id: string, as = teamA): Promise<string | undefined> {
  const row = await stack.http.queryOk<{ label: string } | null>(
    "prglobal:query:link:detail",
    { id },
    as,
  );
  return row?.label;
}

async function labelsOnHost(hostId: string, as = teamA): Promise<readonly string[]> {
  const result = await stack.http.queryOk<{ rows: readonly { label: string }[] }>(
    "prglobal:query:link:list",
    { filters: [{ field: "entityId", op: "eq", value: hostId }] },
    as,
  );
  return result.rows.map((row) => row.label);
}

async function listLabels(
  payload: Record<string, unknown>,
  as = teamA,
): Promise<readonly string[]> {
  const result = await stack.http.queryOk<{ rows: readonly { label: string }[] }>(
    "prglobal:query:link:list",
    payload,
    as,
  );
  return result.rows.map((row) => row.label);
}

describe("parentRef gate on a tenancy global host", () => {
  test("a user who can read the global host sees its join row in detail and list and can update it", async () => {
    const { id, version } = await createLink(LIVE_HOST_ID, "visible");

    expect(await labelInDetail(id)).toBe("visible");
    expect(await labelsOnHost(LIVE_HOST_ID)).toContain("visible");

    await stack.http.writeOk(
      "prglobal:write:link:update",
      { id, version, changes: { label: "edited" } },
      teamA,
    );
    expect(await labelInDetail(id)).toBe("edited");
  });

  test("a user the global host's access.read excludes neither sees nor updates the join row", async () => {
    const { id, version } = await createLink(LIVE_HOST_ID, "team-a only");

    expect(await labelInDetail(id, teamB)).toBeUndefined();
    expect(await labelsOnHost(LIVE_HOST_ID, teamB)).toEqual([]);
    const err = await stack.http.writeErr(
      "prglobal:write:link:update",
      { id, version, changes: { label: "hijacked" } },
      teamB,
    );
    expectErrorIncludes(err, "not_found");
    expect(await labelInDetail(id)).toBe("team-a only");
  });

  test("a join row on a soft-deleted global host is hidden from detail and list", async () => {
    const { id } = await createLink(DELETED_HOST_ID, "orphaned");

    expect(await labelInDetail(id)).toBeUndefined();
    expect(await labelsOnHost(DELETED_HOST_ID)).toEqual([]);
  });

  test("a list without an entityId filter keeps only join rows on readable, live global hosts", async () => {
    await createLink(LIVE_HOST_ID, "unpinned-live");
    await createLink(DELETED_HOST_ID, "unpinned-orphaned");

    const labelsOfTeamA = await listLabels({});
    expect(labelsOfTeamA).toContain("unpinned-live");
    expect(labelsOfTeamA).not.toContain("unpinned-orphaned");
    const labelsOfTeamB = await listLabels({}, teamB);
    expect(labelsOfTeamB).not.toContain("unpinned-live");
    expect(labelsOfTeamB).not.toContain("unpinned-orphaned");
  });

  test("two eq filters on entityId with different values return no rows", async () => {
    await createLink(LIVE_HOST_ID, "conflicting-filters");

    const labels = await listLabels({
      filters: [
        { field: "entityId", op: "eq", value: LIVE_HOST_ID },
        { field: "entityId", op: "eq", value: DELETED_HOST_ID },
      ],
    });
    expect(labels).toEqual([]);
  });

  test("the trash list shows a deleted join row on a soft-deleted global host", async () => {
    await seedRows(
      stack.db,
      linkTable,
      [
        {
          id: TRASHED_LINK_ID,
          tenantId: teamA.tenantId,
          entityType: "globalHost",
          entityId: DELETED_HOST_ID,
          label: "trashed-on-deleted-host",
          isDeleted: true,
        },
      ],
      { projectionOnly: "fixture plants a trashed join row without its event" },
    );

    expect(await listLabels({ onlyDeleted: true })).toContain("trashed-on-deleted-host");
    expect(await listLabels({})).not.toContain("trashed-on-deleted-host");
  });
});
