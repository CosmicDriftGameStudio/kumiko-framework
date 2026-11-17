// A join row whose host the caller cannot read is invisible to detail, so
// update, delete and restore must treat it as missing too.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { expectErrorIncludes, seedRows } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import { buildEntityTable } from "../db/table-builder.ts";
import { defineEntityQueryHandler, defineEntityWriteHandler } from "../engine/entity-handlers.ts";
import { createEntity, createTextField, defineFeature } from "../engine/index.ts";
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

const hostEntity = createEntity({
  name: "host",
  table: "pr_write_hosts",
  softDelete: true,
  fields: {
    teamId: createTextField({ required: true, personal: false, reason: "technical_reference" }),
  },
  access: hostAccess,
});
const hostTable = buildEntityTable(hostEntity);

const linkEntity = createEntity({
  name: "link",
  table: "pr_write_links",
  softDelete: true,
  parentRef: {
    entityTypeField: "entityType",
    entityIdField: "entityId",
    allowedTypes: ["host"],
  },
  fields: {
    entityType: createTextField({ required: true, personal: false, reason: "technical_reference" }),
    entityId: createTextField({ required: true, personal: false, reason: "technical_reference" }),
    label: createTextField({ required: true, personal: false, reason: "test_fixture" }),
  },
});

const linkTable = buildEntityTable(linkEntity);

const feature = defineFeature("prwrite", (r) => {
  r.entity(hostEntity);
  r.entity(linkEntity);
  for (const verb of ["create", "update", "delete", "restore"] as const) {
    r.writeHandler(
      defineEntityWriteHandler(`link:${verb}`, linkEntity, { access: { roles: ["TenantMember"] } }),
    );
  }
  r.queryHandler(
    defineEntityQueryHandler("link:detail", linkEntity, { access: { roles: ["TenantMember"] } }),
  );
});

const userA = createTestUser({ id: 90, roles: ["TenantMember"], claims: { team: "team-a" } });
const userB = createTestUser({ id: 91, roles: ["TenantMember"], claims: { team: "team-b" } });

const HOST_ID = "e0000000-0000-4000-8000-00000000000a";
const DELETED_HOST_ID = "e0000000-0000-4000-8000-00000000000b";
const SEEDED_LINK_ID = "e0000000-0000-4000-8000-0000000000a1";
const DELETED_HOST_LINK_ID = "e0000000-0000-4000-8000-0000000000b1";
const LABEL = "original";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
  await unsafeCreateEntityTable(stack.db, hostEntity, "host");
  await unsafeCreateEntityTable(stack.db, linkEntity, "link");
  await seedRows(
    stack.db,
    hostTable,
    [
      { id: HOST_ID, tenantId: userA.tenantId, teamId: "team-a" },
      { id: DELETED_HOST_ID, tenantId: userA.tenantId, teamId: "team-a", isDeleted: true },
    ],
    { projectionOnly: "fixture plants a projection row without its event" },
  );
  await seedRows(
    stack.db,
    linkTable,
    [
      {
        id: SEEDED_LINK_ID,
        tenantId: userA.tenantId,
        entityType: "host",
        entityId: HOST_ID,
        label: LABEL,
      },
      {
        id: DELETED_HOST_LINK_ID,
        tenantId: userA.tenantId,
        entityType: "host",
        entityId: DELETED_HOST_ID,
        label: LABEL,
      },
    ],
    { projectionOnly: "fixture plants a projection row without its event" },
  );
});

afterAll(async () => {
  await stack.cleanup();
});

async function createLink(): Promise<{ id: string; version: number }> {
  const res = await stack.http.writeOk<{ id: string; data: { version: number } }>(
    "prwrite:write:link:create",
    { entityType: "host", entityId: HOST_ID, label: LABEL },
    userA,
  );
  return { id: res.id, version: res.data.version };
}

async function labelSeenByA(id: string): Promise<string | undefined> {
  const row = await stack.http.queryOk<{ label: string } | null>(
    "prwrite:query:link:detail",
    { id },
    userA,
  );
  return row?.label;
}

describe("parentRef read-gate on detail", () => {
  test("a user who cannot see the host gets null for the join row", async () => {
    const own = await labelSeenByA(SEEDED_LINK_ID);
    expect(own).toBe(LABEL);

    const foreign = await stack.http.queryOk<{ id: string } | null>(
      "prwrite:query:link:detail",
      { id: SEEDED_LINK_ID },
      userB,
    );
    expect(foreign).toBeNull();
  });

  test("a join row on a soft-deleted host is not returned", async () => {
    expect(await labelSeenByA(DELETED_HOST_LINK_ID)).toBeUndefined();
  });
});

describe("parentRef read-gate is enforced on update, delete and restore", () => {
  test("a user who cannot see the host cannot update the join row", async () => {
    const { id, version } = await createLink();
    const err = await stack.http.writeErr(
      "prwrite:write:link:update",
      { id, version, changes: { label: "hijacked" } },
      userB,
    );
    expectErrorIncludes(err, "not_found");
    expect(await labelSeenByA(id)).toBe(LABEL);
  });

  test("a user who cannot see the host cannot delete the join row", async () => {
    const { id } = await createLink();
    const err = await stack.http.writeErr("prwrite:write:link:delete", { id }, userB);
    expectErrorIncludes(err, "not_found");
    expect(await labelSeenByA(id)).toBe(LABEL);
  });

  test("a user who cannot see the host cannot restore the join row", async () => {
    const { id } = await createLink();
    await stack.http.writeOk("prwrite:write:link:delete", { id }, userA);
    const err = await stack.http.writeErr("prwrite:write:link:restore", { id }, userB);
    expectErrorIncludes(err, "not_found");
    expect(await labelSeenByA(id)).toBeUndefined();
  });

  test("a user who can see the host can still update, delete and restore", async () => {
    const { id, version } = await createLink();
    await stack.http.writeOk(
      "prwrite:write:link:update",
      { id, version, changes: { label: "edited" } },
      userA,
    );
    expect(await labelSeenByA(id)).toBe("edited");
    await stack.http.writeOk("prwrite:write:link:delete", { id }, userA);
    expect(await labelSeenByA(id)).toBeUndefined();
    await stack.http.writeOk("prwrite:write:link:restore", { id }, userA);
    expect(await labelSeenByA(id)).toBe("edited");
  });
});
