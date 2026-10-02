// The parent-ref visibility gate must hold on executor.detail, including on an
// entity-cache hit: the cache is keyed by tenant + id, not by caller, so a
// second user reading an id another user already cached must still be checked
// against the live host row. The generic detail handler wires no entityCache,
// so the cached path is reached through a handler that passes ctx.entityCache.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as z from "zod";
import { createEventStoreExecutor } from "../../db/event-store-executor.js";
import { asRawClient } from "../../db/query.js";
import { buildEntityTable } from "../../db/table-builder.js";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "../../stack/index.js";
import { seedRows } from "../../testing/index.js";
import { defineFeature } from "../define-feature.js";
import { createEntity, createTextField } from "../factories.js";
import type { EntityDefinition } from "../types/index.js";

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
  table: "detail_pr_hosts",
  softDelete: true,
  fields: {
    teamId: createTextField({ required: true, personal: false, reason: "technical_reference" }),
  },
  access: hostAccess,
});
const hostTable = buildEntityTable("host", hostEntity);

const linkEntity = createEntity({
  table: "detail_pr_links",
  parentRef: { entityTypeField: "entityType", entityIdField: "entityId" },
  fields: {
    entityType: createTextField({ required: true, personal: false, reason: "technical_reference" }),
    entityId: createTextField({ required: true, personal: false, reason: "technical_reference" }),
  },
});
const linkTable = buildEntityTable("link", linkEntity);

const feature = defineFeature("detailpr", (r) => {
  r.entity("host", hostEntity);
  r.entity("link", linkEntity);
  r.queryHandler(
    "link-cached-detail",
    z.object({ id: z.uuid() }),
    async (query, ctx) =>
      createEventStoreExecutor(linkTable, linkEntity, {
        entityName: "link",
        ...(ctx.entityCache !== undefined && { entityCache: ctx.entityCache }),
      }).detail(query.payload, query.user, ctx.db, {
        parentVisibility: { entities: ctx.registry.getAllEntities() },
      }),
    { access: { roles: ["TenantMember"] } },
  );
});

const userA = createTestUser({ id: 80, roles: ["TenantMember"], claims: { team: "team-a" } });
const userB = createTestUser({ id: 81, roles: ["TenantMember"], claims: { team: "team-b" } });

const HOST_ID = "d0000000-0000-4000-8000-00000000000a";
const LINK_ID = "d0000000-0000-4000-8000-0000000000a1";
const DELETED_HOST_ID = "d0000000-0000-4000-8000-00000000000b";
const DELETED_HOST_LINK_ID = "d0000000-0000-4000-8000-0000000000b1";
const DETAIL = "detailpr:query:link-cached-detail";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
  await unsafeCreateEntityTable(stack.db, hostEntity, "host");
  await unsafeCreateEntityTable(stack.db, linkEntity, "link");
  await seedRows(stack.db, hostTable, [
    { id: HOST_ID, tenantId: userA.tenantId, teamId: "team-a" },
    { id: DELETED_HOST_ID, tenantId: userA.tenantId, teamId: "team-a" },
  ]);
  await seedRows(stack.db, linkTable, [
    { id: LINK_ID, tenantId: userA.tenantId, entityType: "host", entityId: HOST_ID },
    {
      id: DELETED_HOST_LINK_ID,
      tenantId: userA.tenantId,
      entityType: "host",
      entityId: DELETED_HOST_ID,
    },
  ]);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("parentRef gate on executor.detail with the entity cache", () => {
  test("a user who cannot see the host gets null, also after another user filled the entity cache", async () => {
    const own = await stack.http.queryOk<{ id: string } | null>(DETAIL, { id: LINK_ID }, userA);
    expect(own?.id).toBe(LINK_ID);

    const foreign = await stack.http.queryOk<{ id: string } | null>(DETAIL, { id: LINK_ID }, userB);
    expect(foreign).toBeNull();
  });

  test("a join row on a soft-deleted host is not returned, also from the entity cache", async () => {
    const before = await stack.http.queryOk<{ id: string } | null>(
      DETAIL,
      { id: DELETED_HOST_LINK_ID },
      userA,
    );
    expect(before?.id).toBe(DELETED_HOST_LINK_ID);

    await asRawClient(stack.db).unsafe(
      "UPDATE detail_pr_hosts SET is_deleted = TRUE WHERE id = $1",
      [DELETED_HOST_ID],
    );

    const after = await stack.http.queryOk<{ id: string } | null>(
      DETAIL,
      { id: DELETED_HOST_LINK_ID },
      userA,
    );
    expect(after).toBeNull();
  });
});
