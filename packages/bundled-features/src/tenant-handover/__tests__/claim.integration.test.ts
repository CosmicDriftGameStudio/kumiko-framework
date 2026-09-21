// tenant-handover's `claim` write end-to-end over real /api/write calls
// (kumiko-framework#3035): an anonymous run (root entity + a parentRef-linked
// child) created under a source tenant, claimed into a destination tenant's
// account via a row-bound grant. Fixture entities stand in for offlot-app's
// vehicle/photo pair — see ../grant.ts and ../move-entity-graph.ts headers
// for the identity + same-transaction design this exercises.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  buildEntityTable,
  createEventStoreExecutor,
  createTenantDb,
  executeRawQuery,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createSystemUser,
  createTextField,
  defineFeature,
  type EntityDefinition,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { loadAggregate } from "@cosmicdrift/kumiko-framework/event-store";
import { fileRefEntity, fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { expectErrorIncludes } from "@cosmicdrift/kumiko-framework/testing";
import { signTenantHandoverGrant } from "../grant";
import { createTenantHandoverFeature } from "../index";

const CLAIM = "tenant-handover:write:claim";
const SECRET = "tenant-handover-integration-secret";

const runEntity: EntityDefinition = createEntity({
  table: "handover_run",
  idType: "uuid",
  transferable: true,
  fields: {
    name: createTextField({ required: true, personal: false, reason: "technical_reference" }),
  },
});

const photoEntity: EntityDefinition = createEntity({
  table: "handover_photo",
  idType: "uuid",
  transferable: true,
  parentRef: { entityTypeField: "hostType", entityIdField: "hostId", allowedTypes: ["run"] },
  fields: {
    hostType: createTextField({ required: true, personal: false, reason: "technical_reference" }),
    hostId: createTextField({ required: true, personal: false, reason: "technical_reference" }),
    caption: createTextField({ personal: false, reason: "technical_reference" }),
  },
});

// Deliberately declares NO `transferable` — proves the named-error rejection.
const noteEntity: EntityDefinition = createEntity({
  table: "handover_note",
  idType: "uuid",
  parentRef: { entityTypeField: "hostType", entityIdField: "hostId", allowedTypes: ["run"] },
  fields: {
    hostType: createTextField({ required: true, personal: false, reason: "technical_reference" }),
    hostId: createTextField({ required: true, personal: false, reason: "technical_reference" }),
    body: createTextField({ personal: false, reason: "technical_reference" }),
  },
});

// A second edge off the root (kumiko-framework#3131), so `campaign` below is
// reachable both directly from the run and one hop further out through here.
const bundleEntity: EntityDefinition = createEntity({
  table: "handover_bundle",
  idType: "uuid",
  transferable: true,
  fields: {
    runId: { type: "reference", entity: "run", required: true },
    label: createTextField({ personal: false, reason: "technical_reference" }),
  },
});

// Hangs off the root through a plain `reference` field rather than a parentRef
// (kumiko-framework#3088) — offlot-app's campaign.vehicleId shape. Neither
// reference is required: a campaign reached through the bundle names no run,
// which is what puts it on the longer of the two paths (#3131).
const campaignEntity: EntityDefinition = createEntity({
  table: "handover_campaign",
  idType: "uuid",
  transferable: true,
  fields: {
    runId: { type: "reference", entity: "run" },
    bundleId: { type: "reference", entity: "bundle" },
    label: createTextField({ personal: false, reason: "technical_reference" }),
  },
});

// The second level: references the campaign, not the root. Nothing links it to
// the run directly, so it only moves if the graph nests.
const channelTextEntity: EntityDefinition = createEntity({
  table: "handover_channel_text",
  idType: "uuid",
  transferable: true,
  fields: {
    campaignId: { type: "reference", entity: "campaign", required: true },
    body: createTextField({ personal: false, reason: "technical_reference" }),
  },
});

// A two-type reference cycle (kumiko-framework#3131). Terminating on one is no
// longer a property of the resolver — it follows from the mover's statements
// only matching rows still in the source tenant — and a cycle is the one shape
// the boot validator's depth check cannot measure, because how far it runs
// depends on the rows rather than the declaration.
const linkAEntity: EntityDefinition = createEntity({
  table: "handover_link_a",
  idType: "uuid",
  transferable: true,
  fields: {
    runId: { type: "reference", entity: "run" },
    viaB: { type: "reference", entity: "linkB" },
  },
});

const linkBEntity: EntityDefinition = createEntity({
  table: "handover_link_b",
  idType: "uuid",
  transferable: true,
  fields: {
    viaA: { type: "reference", entity: "linkA", required: true },
  },
});

const handoverFixturesFeature = defineFeature("handover-fixtures", (r) => {
  r.entity("run", runEntity);
  r.entity("photo", photoEntity);
  r.entity("note", noteEntity);
  r.entity("bundle", bundleEntity);
  r.entity("campaign", campaignEntity);
  r.entity("channelText", channelTextEntity);
  r.entity("linkA", linkAEntity);
  r.entity("linkB", linkBEntity);
});

const runTable = buildEntityTable("run", runEntity);
const photoTable = buildEntityTable("photo", photoEntity);
const noteTable = buildEntityTable("note", noteEntity);
const bundleTable = buildEntityTable("bundle", bundleEntity);
const campaignTable = buildEntityTable("campaign", campaignEntity);
const channelTextTable = buildEntityTable("channelText", channelTextEntity);
const linkATable = buildEntityTable("linkA", linkAEntity);
const linkBTable = buildEntityTable("linkB", linkBEntity);

const runCrud = createEventStoreExecutor(runTable, runEntity, { entityName: "run" });
const photoCrud = createEventStoreExecutor(photoTable, photoEntity, { entityName: "photo" });
const noteCrud = createEventStoreExecutor(noteTable, noteEntity, { entityName: "note" });
const bundleCrud = createEventStoreExecutor(bundleTable, bundleEntity, { entityName: "bundle" });
const campaignCrud = createEventStoreExecutor(campaignTable, campaignEntity, {
  entityName: "campaign",
});
const channelTextCrud = createEventStoreExecutor(channelTextTable, channelTextEntity, {
  entityName: "channelText",
});
const linkACrud = createEventStoreExecutor(linkATable, linkAEntity, { entityName: "linkA" });
const linkBCrud = createEventStoreExecutor(linkBTable, linkBEntity, { entityName: "linkB" });
const fileRefCrud = createEventStoreExecutor(fileRefsTable, fileRefEntity, {
  entityName: "fileRef",
});

let stack: TestStack;

const SOURCE_TENANT = testTenantId(3);

// The claim handler rate-limits `per: "user"` — a fresh, distinct user id per
// call keeps every test (and every concurrency-loop iteration) in its own
// bucket instead of tripping the limiter across unrelated calls.
let nextUserId = 1;

function destinationUser(tenantN: number) {
  return createTestUser({ id: nextUserId++, tenantId: testTenantId(tenantN), roles: ["User"] });
}

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createTenantHandoverFeature({ grantSecret: SECRET }), handoverFixturesFeature],
  });
  await unsafeCreateEntityTable(stack.db, runEntity, "run");
  await unsafeCreateEntityTable(stack.db, photoEntity, "photo");
  await unsafeCreateEntityTable(stack.db, noteEntity, "note");
  await unsafeCreateEntityTable(stack.db, bundleEntity, "bundle");
  await unsafeCreateEntityTable(stack.db, campaignEntity, "campaign");
  await unsafeCreateEntityTable(stack.db, channelTextEntity, "channelText");
  await unsafeCreateEntityTable(stack.db, linkAEntity, "linkA");
  await unsafeCreateEntityTable(stack.db, linkBEntity, "linkB");
  await unsafeCreateEntityTable(stack.db, fileRefEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  stack.events.reset();
  await stack.db.unsafe?.(
    `TRUNCATE kumiko_events, kumiko_snapshots, handover_run, handover_photo, handover_note, handover_bundle, handover_campaign, handover_channel_text, handover_link_a, handover_link_b, file_refs RESTART IDENTITY CASCADE`,
  );
});

async function seedRun(tenantId: TenantId, name: string): Promise<string> {
  const user = createSystemUser(tenantId);
  const db = createTenantDb(stack.db, tenantId, "system");
  const result = await runCrud.create({ name }, user, db);
  if (!result.isSuccess) throw new Error(`seedRun failed: ${result.error.message}`);
  return String(result.data.id);
}

async function seedPhoto(tenantId: TenantId, hostId: string, caption: string): Promise<string> {
  const user = createSystemUser(tenantId);
  const db = createTenantDb(stack.db, tenantId, "system");
  const result = await photoCrud.create({ hostType: "run", hostId, caption }, user, db);
  if (!result.isSuccess) throw new Error(`seedPhoto failed: ${result.error.message}`);
  return String(result.data.id);
}

async function seedNote(tenantId: TenantId, hostId: string, body: string): Promise<string> {
  const user = createSystemUser(tenantId);
  const db = createTenantDb(stack.db, tenantId, "system");
  const result = await noteCrud.create({ hostType: "run", hostId, body }, user, db);
  if (!result.isSuccess) throw new Error(`seedNote failed: ${result.error.message}`);
  return String(result.data.id);
}

async function seedBundle(tenantId: TenantId, runId: string, label: string): Promise<string> {
  const user = createSystemUser(tenantId);
  const db = createTenantDb(stack.db, tenantId, "system");
  const result = await bundleCrud.create({ runId, label }, user, db);
  if (!result.isSuccess) throw new Error(`seedBundle failed: ${result.error.message}`);
  return String(result.data.id);
}

async function seedCampaign(tenantId: TenantId, runId: string, label: string): Promise<string> {
  const user = createSystemUser(tenantId);
  const db = createTenantDb(stack.db, tenantId, "system");
  const result = await campaignCrud.create({ runId, label }, user, db);
  if (!result.isSuccess) throw new Error(`seedCampaign failed: ${result.error.message}`);
  return String(result.data.id);
}

async function seedCampaignInBundle(
  tenantId: TenantId,
  bundleId: string,
  label: string,
): Promise<string> {
  const user = createSystemUser(tenantId);
  const db = createTenantDb(stack.db, tenantId, "system");
  const result = await campaignCrud.create({ bundleId, label }, user, db);
  if (!result.isSuccess) throw new Error(`seedCampaignInBundle failed: ${result.error.message}`);
  return String(result.data.id);
}

async function seedChannelText(
  tenantId: TenantId,
  campaignId: string,
  body: string,
): Promise<string> {
  const user = createSystemUser(tenantId);
  const db = createTenantDb(stack.db, tenantId, "system");
  const result = await channelTextCrud.create({ campaignId, body }, user, db);
  if (!result.isSuccess) throw new Error(`seedChannelText failed: ${result.error.message}`);
  return String(result.data.id);
}

async function seedLinkA(
  tenantId: TenantId,
  parent: { readonly runId: string } | { readonly viaB: string },
): Promise<string> {
  const user = createSystemUser(tenantId);
  const db = createTenantDb(stack.db, tenantId, "system");
  const result = await linkACrud.create(parent, user, db);
  if (!result.isSuccess) throw new Error(`seedLinkA failed: ${result.error.message}`);
  return String(result.data.id);
}

async function seedLinkB(tenantId: TenantId, viaA: string): Promise<string> {
  const user = createSystemUser(tenantId);
  const db = createTenantDb(stack.db, tenantId, "system");
  const result = await linkBCrud.create({ viaA }, user, db);
  if (!result.isSuccess) throw new Error(`seedLinkB failed: ${result.error.message}`);
  return String(result.data.id);
}

// Closes the cycle in the DATA, not just in the schema: `linkA` can only point
// back once its `linkB` exists. Without this the return edge matches no row at
// all and a walk would terminate for the wrong reason.
async function pointLinkABack(tenantId: TenantId, linkAId: string, viaB: string): Promise<void> {
  const user = createSystemUser(tenantId);
  const db = createTenantDb(stack.db, tenantId, "system");
  const result = await linkACrud.update({ id: linkAId, version: 1, changes: { viaB } }, user, db);
  if (!result.isSuccess) throw new Error(`pointLinkABack failed: ${result.error.message}`);
}

async function seedFileRef(
  tenantId: TenantId,
  entityType: string,
  entityId: string,
): Promise<void> {
  const user = createSystemUser(tenantId);
  const db = createTenantDb(stack.db, tenantId, "system");
  const result = await fileRefCrud.create(
    {
      storageKey: `${tenantId}/${entityType}/${entityId}/photo/x.jpg`,
      fileName: "photo.jpg",
      mimeType: "image/jpeg",
      size: 10,
      entityType,
      entityId,
      fieldName: "photo",
    },
    user,
    db,
  );
  if (!result.isSuccess) throw new Error(`seedFileRef failed: ${result.error.message}`);
}

function grantFor(rowId: string): string {
  return signTenantHandoverGrant({
    entityType: "run",
    rowId,
    sourceTenantId: SOURCE_TENANT,
    ttlMinutes: 30,
    secret: SECRET,
  }).token;
}

async function readTenantId(table: string, id: string): Promise<string | undefined> {
  const rows = await executeRawQuery<{ tenantId: string }>(
    stack.db,
    `SELECT tenant_id AS "tenantId" FROM ${table} WHERE id = $1`,
    [id],
  );
  return rows[0]?.tenantId;
}

describe("tenant-handover :: claim", () => {
  test("claims the root, its parentRef-linked child, and both attached files into the caller's tenant, leaving an unrelated run of the same type untouched", async () => {
    const runId = await seedRun(SOURCE_TENANT, "my run");
    const photoId = await seedPhoto(SOURCE_TENANT, runId, "front");
    await seedFileRef(SOURCE_TENANT, "run", runId);
    await seedFileRef(SOURCE_TENANT, "photo", photoId);

    // A second, unrelated run of the SAME entity type, still in the source
    // tenant — proves the claim moves only the identified run's rows, not
    // every "run" row that happens to share the type.
    const otherRunId = await seedRun(SOURCE_TENANT, "someone else's run");
    const otherPhotoId = await seedPhoto(SOURCE_TENANT, otherRunId, "side");

    const dest = destinationUser(1);
    const data = await stack.http.writeOk<{
      id: string;
      sourceTenantId: string;
      destinationTenantId: string;
      movedEntities: Record<string, number>;
    }>(CLAIM, { token: grantFor(runId), entityType: "run" }, dest);

    expect(data.id).toBe(runId);
    expect(data.sourceTenantId).toBe(SOURCE_TENANT);
    expect(data.destinationTenantId).toBe(dest.tenantId);
    expect(data.movedEntities).toEqual({ run: 1, photo: 1, fileRef: 2 });

    // Only the identified run's rows moved — the projection tables themselves
    // now carry the destination tenant.
    expect(await readTenantId("handover_run", runId)).toBe(dest.tenantId);
    expect(await readTenantId("handover_photo", photoId)).toBe(dest.tenantId);
    const fileRows = await executeRawQuery<{ tenantId: string; entityId: string }>(
      stack.db,
      `SELECT tenant_id AS "tenantId", entity_id AS "entityId" FROM file_refs WHERE entity_id = ANY($1)`,
      [[runId, photoId]],
    );
    expect(fileRows).toHaveLength(2);
    for (const row of fileRows) expect(row.tenantId).toBe(dest.tenantId);

    // The event history moved too, not just the projection row: loading the
    // aggregate under the NEW tenant still sees its full history.
    const events = await loadAggregate(stack.db, runId, dest.tenantId);
    expect(events.some((e) => e.type === "run.created")).toBe(true);

    // The audit entry: its own aggregate (events.ts), naming source tenant,
    // destination tenant, and a count per moved entity.
    const auditEvents = await executeRawQuery<{ payload: Record<string, unknown> }>(
      stack.db,
      `SELECT payload FROM kumiko_events WHERE type = 'tenant-handover:event:claimed' AND tenant_id = $1`,
      [dest.tenantId],
    );
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]?.payload).toMatchObject({
      entityType: "run",
      rootRowId: runId,
      sourceTenantId: SOURCE_TENANT,
      destinationTenantId: dest.tenantId,
      movedEntities: { run: 1, photo: 1, fileRef: 2 },
    });

    // Nothing is left behind under the source tenant.
    const eventsUnderSource = await loadAggregate(stack.db, runId, SOURCE_TENANT);
    expect(eventsUnderSource).toHaveLength(0);

    // The unrelated run (same entity type, different row) never moved.
    expect(await readTenantId("handover_run", otherRunId)).toBe(SOURCE_TENANT);
    expect(await readTenantId("handover_photo", otherPhotoId)).toBe(SOURCE_TENANT);
  });

  // kumiko-framework#3088: before this, resolveChildCandidates only knew
  // parentRef, so a graph hanging off `reference` fields moved the root row
  // alone and left its children in the source tenant.
  test("claims a two-level reference graph whole: root -> campaign -> channelText", async () => {
    const runId = await seedRun(SOURCE_TENANT, "my run");
    const campaignId = await seedCampaign(SOURCE_TENANT, runId, "spring");
    const channelTextId = await seedChannelText(SOURCE_TENANT, campaignId, "for sale");

    // A second run with its own campaign and text — proves the walk follows
    // the identified row's edges, not every row of a participating type.
    const otherRunId = await seedRun(SOURCE_TENANT, "someone else's run");
    const otherCampaignId = await seedCampaign(SOURCE_TENANT, otherRunId, "summer");
    const otherChannelTextId = await seedChannelText(SOURCE_TENANT, otherCampaignId, "theirs");

    const dest = destinationUser(1);
    const data = await stack.http.writeOk<{
      movedEntities: Record<string, number>;
    }>(CLAIM, { token: grantFor(runId), entityType: "run" }, dest);

    expect(data.movedEntities).toEqual({ run: 1, campaign: 1, channelText: 1 });

    expect(await readTenantId("handover_run", runId)).toBe(dest.tenantId);
    expect(await readTenantId("handover_campaign", campaignId)).toBe(dest.tenantId);
    // The second level: reachable only through the campaign, never named by
    // the grant.
    expect(await readTenantId("handover_channel_text", channelTextId)).toBe(dest.tenantId);

    // Event history follows at every level, not just for the root.
    expect(
      (await loadAggregate(stack.db, channelTextId, dest.tenantId)).some(
        (e) => e.type === "channelText.created",
      ),
    ).toBe(true);
    expect(await loadAggregate(stack.db, channelTextId, SOURCE_TENANT)).toHaveLength(0);

    // The unrelated run's whole chain stayed put.
    expect(await readTenantId("handover_run", otherRunId)).toBe(SOURCE_TENANT);
    expect(await readTenantId("handover_campaign", otherCampaignId)).toBe(SOURCE_TENANT);
    expect(await readTenantId("handover_channel_text", otherChannelTextId)).toBe(SOURCE_TENANT);
  });

  // kumiko-framework#3131: `campaign` is reachable one hop from the run AND two
  // hops through the bundle. The level-wise walk ran the campaign->channelText
  // edge once, on the first level it was reachable, so the texts under the
  // campaign found on the longer path stayed in the source tenant — silently,
  // the same failure class as #3088 one level deeper.
  test("follows a type reached by two paths of different length down both", async () => {
    const runId = await seedRun(SOURCE_TENANT, "my run");
    const bundleId = await seedBundle(SOURCE_TENANT, runId, "bundle");
    const nearCampaignId = await seedCampaign(SOURCE_TENANT, runId, "straight off the run");
    const farCampaignId = await seedCampaignInBundle(SOURCE_TENANT, bundleId, "via the bundle");
    const nearTextId = await seedChannelText(SOURCE_TENANT, nearCampaignId, "near");
    const farTextId = await seedChannelText(SOURCE_TENANT, farCampaignId, "far");

    const dest = destinationUser(1);
    const data = await stack.http.writeOk<{ movedEntities: Record<string, number> }>(
      CLAIM,
      { token: grantFor(runId), entityType: "run" },
      dest,
    );

    expect(data.movedEntities).toEqual({ run: 1, bundle: 1, campaign: 2, channelText: 2 });

    expect(await readTenantId("handover_bundle", bundleId)).toBe(dest.tenantId);
    expect(await readTenantId("handover_campaign", nearCampaignId)).toBe(dest.tenantId);
    expect(await readTenantId("handover_campaign", farCampaignId)).toBe(dest.tenantId);
    expect(await readTenantId("handover_channel_text", nearTextId)).toBe(dest.tenantId);
    // The row the old walk left behind.
    expect(await readTenantId("handover_channel_text", farTextId)).toBe(dest.tenantId);

    // History follows the late-found rows too, not just their projection.
    expect(await loadAggregate(stack.db, farTextId, SOURCE_TENANT)).toHaveLength(0);
    expect(
      (await loadAggregate(stack.db, farTextId, dest.tenantId)).some(
        (e) => e.type === "channelText.created",
      ),
    ).toBe(true);
  });

  // A cycle used to terminate because each edge ran at most once. That rule is
  // gone (kumiko-framework#3131) — termination now rests on every statement
  // filtering `tenant_id = source` and returning only the rows it flipped, so a
  // row enters the worklist exactly once. Nothing else bounds the walk, which is
  // why the rows below point at each other BOTH ways: the return edge has to
  // match `linkA` and be turned away by the tenant filter, not miss it.
  test("terminates on a reference cycle instead of running the rounds out", async () => {
    const runId = await seedRun(SOURCE_TENANT, "my run");
    const linkAId = await seedLinkA(SOURCE_TENANT, { runId });
    const linkBId = await seedLinkB(SOURCE_TENANT, linkAId);
    await pointLinkABack(SOURCE_TENANT, linkAId, linkBId);

    const dest = destinationUser(1);
    const data = await stack.http.writeOk<{ movedEntities: Record<string, number> }>(
      CLAIM,
      { token: grantFor(runId), entityType: "run" },
      dest,
    );

    expect(data.movedEntities).toEqual({ run: 1, linkA: 1, linkB: 1 });
    expect(await readTenantId("handover_link_a", linkAId)).toBe(dest.tenantId);
    expect(await readTenantId("handover_link_b", linkBId)).toBe(dest.tenantId);
  });

  // The boot validator skips cycles when measuring depth, so this graph boots
  // clean and only the mover can catch it. Failing the whole claim is the
  // point: the alternative is moving the first five hops and leaving the rest,
  // which is the silent partial move #3088 exists to end.
  test("fails the claim when the rounds run out with rows still leading somewhere", async () => {
    const runId = await seedRun(SOURCE_TENANT, "my run");
    const a1 = await seedLinkA(SOURCE_TENANT, { runId });
    const b1 = await seedLinkB(SOURCE_TENANT, a1);
    const a2 = await seedLinkA(SOURCE_TENANT, { viaB: b1 });
    const b2 = await seedLinkB(SOURCE_TENANT, a2);
    const a3 = await seedLinkA(SOURCE_TENANT, { viaB: b2 });

    const dest = destinationUser(1);
    const err = await stack.http.writeErr(
      CLAIM,
      { token: grantFor(runId), entityType: "run" },
      dest,
    );

    expect(err.httpStatus).toBe(422);
    expectErrorIncludes(err, "transfer_graph_too_deep");

    // Rolled back whole: neither the root nor the rows five hops in moved.
    expect(await readTenantId("handover_run", runId)).toBe(SOURCE_TENANT);
    expect(await readTenantId("handover_link_a", a1)).toBe(SOURCE_TENANT);
    expect(await readTenantId("handover_link_a", a3)).toBe(SOURCE_TENANT);
  });

  test("replaying the same grant fails the same way an invalid one would, and changes nothing", async () => {
    const runId = await seedRun(SOURCE_TENANT, "my run");
    const dest = destinationUser(1);
    const token = grantFor(runId);

    await stack.http.writeOk(CLAIM, { token, entityType: "run" }, dest);
    const replay = await stack.http.writeErr(CLAIM, { token, entityType: "run" }, dest);

    expect(replay.httpStatus).toBe(422);
    expect(await readTenantId("handover_run", runId)).toBe(dest.tenantId);
  });

  test("two simultaneous claims of one grant into different tenants leave exactly one winner", async () => {
    for (let i = 0; i < 20; i++) {
      const runId = await seedRun(SOURCE_TENANT, `run-${i}`);
      const token = grantFor(runId);
      const destA = destinationUser(1);
      const destB = destinationUser(2);

      const [resA, resB] = await Promise.all([
        stack.http.write(CLAIM, { token, entityType: "run" }, destA),
        stack.http.write(CLAIM, { token, entityType: "run" }, destB),
      ]);

      expect([resA.status, resB.status].sort()).toEqual([200, 422]);

      const finalTenant = await readTenantId("handover_run", runId);
      if (finalTenant === undefined) throw new Error("run row disappeared after the race");
      expect([destA.tenantId, destB.tenantId]).toContain(finalTenant);

      await stack.db.unsafe?.(
        `TRUNCATE kumiko_events, kumiko_snapshots, handover_run RESTART IDENTITY CASCADE`,
      );
    }
  });

  test("a caller without an allowed role is rejected before the handler body runs", async () => {
    // "Driver" is a real role in this framework's test fixtures but is not
    // in claim's access.roles list (Member/User/TenantAdmin/SystemAdmin) —
    // role-gating rejects it at dispatch, before the handler ever reads
    // event.payload, so a garbage token/entityType still proves the point.
    const outsider = createTestUser({
      id: nextUserId++,
      tenantId: testTenantId(1),
      roles: ["Driver"],
    });
    const err = await stack.http.writeErr(
      CLAIM,
      { token: "not.a.token", entityType: "run" },
      outsider,
    );
    expectErrorIncludes(err, "access_denied");
  });

  test("an unregistered or not-declared-transferable entityType is rejected before the grant is even touched", async () => {
    const dest = destinationUser(1);
    const err = await stack.http.writeErr(
      CLAIM,
      { token: "not.a.token", entityType: "unknown-entity" },
      dest,
    );
    expect(err.httpStatus).toBe(422);
  });

  test("a parentRef-linked child that is not declared transferable blocks the whole claim, root included", async () => {
    const runId = await seedRun(SOURCE_TENANT, "my run");
    await seedNote(SOURCE_TENANT, runId, "undeclared child");
    const dest = destinationUser(1);

    const err = await stack.http.writeErr(
      CLAIM,
      { token: grantFor(runId), entityType: "run" },
      dest,
    );
    expect(err.httpStatus).toBe(422);

    // The whole transaction rolled back — the root never moved either.
    expect(await readTenantId("handover_run", runId)).toBe(SOURCE_TENANT);
  });
});
