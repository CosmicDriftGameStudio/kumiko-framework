// form-draft cleanup job — real Postgres + real BullMQ dispatch (via
// stack.jobRunner), no hand-fed context. Covers the #1891 acceptance
// criteria: an old draft is deleted, a fresh one survives, and the
// retention window actually comes from the config key (not a hardcoded
// constant). Also covers #1915: FileRefs in a stale draft's blob are
// released through the storage provider before the row is deleted, resolved
// per-row's OWN tenant (not the job's SYSTEM_TENANT_ID run-tenant) — a
// two-tenant, two-provider setup below proves rows never cross providers.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createInMemoryFileProvider,
  fileRefEntity,
  type InMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createTestEnvelopeCipher, waitFor } from "@cosmicdrift/kumiko-framework/testing";
import { ConfigHandlers } from "../../config/constants";
import { createConfigAccessorFactory, createConfigFeature } from "../../config/feature";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { FormDraftHandlers } from "../constants";
import { formDraftEntity } from "../entity";
import { formDraftFeature } from "../feature";
import { FORM_DRAFT_RETENTION_DAYS_CONFIG_KEY } from "../handlers/cleanup.job";

let stack: TestStack;

const systemAdmin = createTestUser({ id: 1, roles: ["SystemAdmin"] });
const owner = createTestUser({ id: 2, roles: ["TenantMember"] });

const TENANT_B: TenantId = testTenantId(2);
const ownerTenantB = createTestUser({ id: 3, roles: ["TenantMember"], tenantId: TENANT_B });

const providerA: InMemoryFileProvider = createInMemoryFileProvider();
const providerB: InMemoryFileProvider = createInMemoryFileProvider();

beforeAll(async () => {
  const testEncryptionKey = randomBytes(32).toString("base64");
  const encryption = createTestEnvelopeCipher(testEncryptionKey);
  const resolver = createConfigResolver({ cipher: encryption });

  stack = await setupTestStack({
    features: [formDraftFeature, createConfigFeature()],
    jobs: {
      consumerLane: "worker",
      queueNamePrefix: `kumiko-form-draft-cleanup-test-${Date.now()}`,
    },
    extraContext: ({ registry }) => ({
      configResolver: resolver,
      configEncryption: encryption,
      _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
      // Two providers, keyed by tenant — proves the cleanup job resolves
      // each stale row's OWN tenant rather than reusing a single
      // job-level ctx.files (which would be bound to SYSTEM_TENANT_ID, the
      // tenant this system-wide job actually dispatches under).
      _fileProviderResolver: (tenantId: TenantId) =>
        Promise.resolve(tenantId === TENANT_B ? providerB : providerA),
    }),
  });
  await unsafeCreateEntityTable(stack.db, formDraftEntity);
  await unsafeCreateEntityTable(stack.db, fileRefEntity, "fileRef");
  await unsafePushTables(stack.db, { configValuesTable });
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  providerA.clear();
  providerB.clear();
  await asRawClient(stack.db).unsafe("DELETE FROM kumiko_events");
  await asRawClient(stack.db).unsafe("DELETE FROM read_form_drafts");
  await asRawClient(stack.db).unsafe("DELETE FROM read_config_values");
  await asRawClient(stack.db).unsafe("DELETE FROM file_refs");
});

async function saveDraft(
  draftKey: string,
  values: Record<string, unknown> = { note: "x" },
  user = owner,
): Promise<void> {
  await stack.http.writeOk(FormDraftHandlers.save, { draftKey, values, stepIndex: 0 }, user);
}

function fileRefPointer(storageKey: string) {
  return { id: "file-1", storageKey, fileName: "photo.jpg", mimeType: "image/jpeg", size: 3 };
}

// The real file_refs row a genuine POST /files upload would have created —
// filterOwnedStorageKeys requires this to exist before a release proceeds.
async function seedFileRef(storageKey: string, uploader = owner): Promise<void> {
  await asRawClient(stack.db).unsafe(
    `INSERT INTO "file_refs" ("tenant_id", "storage_key", "file_name", "mime_type", "size", "inserted_by_id")
     VALUES ($1, $2, 'photo.jpg', 'image/jpeg', 3, $3)`,
    [uploader.tenantId, storageKey, uploader.id],
  );
}

async function backdate(draftKey: string, daysAgo: number): Promise<void> {
  await asRawClient(stack.db).unsafe(
    `UPDATE "read_form_drafts"
     SET "inserted_at" = now() - ($1::int * interval '1 day'),
         "modified_at" = now() - ($1::int * interval '1 day')
     WHERE "draft_key" = $2`,
    [daysAgo, draftKey],
  );
}

// applyEntityEvent only stamps modified_at on updated/deleted/restored, never
// on created (framework/src/db/apply-entity-event.ts) — a draft saved exactly
// once has modified_at IS NULL, which is the real-world case the cleanup
// query's COALESCE(modified_at, inserted_at) fallback exists for.
async function backdateInsertedOnly(draftKey: string, daysAgo: number): Promise<void> {
  await asRawClient(stack.db).unsafe(
    `UPDATE "read_form_drafts"
     SET "inserted_at" = now() - ($1::int * interval '1 day'),
         "modified_at" = NULL
     WHERE "draft_key" = $2`,
    [daysAgo, draftKey],
  );
}

async function backdateFileRef(storageKey: string, daysAgo: number): Promise<void> {
  await asRawClient(stack.db).unsafe(
    `UPDATE "file_refs" SET "inserted_at" = now() - ($1::int * interval '1 day')
     WHERE "storage_key" = $2`,
    [daysAgo, storageKey],
  );
}

async function draftExists(draftKey: string): Promise<boolean> {
  const rows = await asRawClient(stack.db).unsafe(
    "SELECT 1 FROM read_form_drafts WHERE draft_key = $1",
    [draftKey],
  );
  return (rows as unknown[]).length > 0;
}

async function setRetentionDays(days: number): Promise<void> {
  await stack.http.writeOk(
    ConfigHandlers.set,
    { key: FORM_DRAFT_RETENTION_DAYS_CONFIG_KEY, value: days },
    systemAdmin,
  );
}

async function dispatchCleanup(): Promise<void> {
  if (!stack.jobRunner) throw new Error("jobRunner not wired — check setupTestStack jobs option");
  await stack.jobRunner.dispatch("form-draft:job:cleanup", {});
}

describe("form-draft cleanup job", () => {
  test("deletes a draft older than the default retention window, leaves a fresh one alone", async () => {
    await saveDraft("wizard:old");
    await backdate("wizard:old", 31);
    await saveDraft("wizard:fresh");
    await dispatchCleanup();

    await waitFor(async () => {
      expect(await draftExists("wizard:old")).toBe(false);
    });
    expect(await draftExists("wizard:fresh")).toBe(true);
  });

  test("honours a retention window set via the config key", async () => {
    await setRetentionDays(2);
    await saveDraft("wizard:stale");
    await backdate("wizard:stale", 3);
    await saveDraft("wizard:recent");
    await backdate("wizard:recent", 1);
    await dispatchCleanup();

    await waitFor(async () => {
      expect(await draftExists("wizard:stale")).toBe(false);
    });
    expect(await draftExists("wizard:recent")).toBe(true);
  });

  test("without a configured override, the same 3-day-old draft survives under the 30-day default", async () => {
    await saveDraft("wizard:three-days-old");
    await backdate("wizard:three-days-old", 3);
    await saveDraft("wizard:sentinel");
    await backdate("wizard:sentinel", 31);
    await dispatchCleanup();

    // Positive completion signal via the sentinel — proves the run finished
    // without relying on a fixed sleep, then asserts the config-boundary case.
    await waitFor(async () => {
      expect(await draftExists("wizard:sentinel")).toBe(false);
    });
    expect(await draftExists("wizard:three-days-old")).toBe(true);
  });

  test("deletes a draft saved exactly once (modified_at IS NULL), falling back to inserted_at", async () => {
    await saveDraft("wizard:once-saved");
    await backdateInsertedOnly("wizard:once-saved", 31);
    await saveDraft("wizard:fresh-once-saved");
    await backdateInsertedOnly("wizard:fresh-once-saved", 1);
    await dispatchCleanup();

    await waitFor(async () => {
      expect(await draftExists("wizard:once-saved")).toBe(false);
    });
    expect(await draftExists("wizard:fresh-once-saved")).toBe(true);
  });
});

describe("form-draft cleanup job — FileRef release (#1915)", () => {
  test("releases FileRefs from a stale draft, leaves a FileRef-less stale draft and a fresh draft unaffected", async () => {
    const key = "tenant-a/vehicle/photo.jpg";
    await providerA.write(key, new Uint8Array([1, 2, 3]), "image/jpeg");
    await seedFileRef(key);

    await saveDraft("wizard:stale-with-photo", { photo: fileRefPointer(key) });
    await backdate("wizard:stale-with-photo", 31);
    await saveDraft("wizard:stale-no-photo", { note: "plain" });
    await backdate("wizard:stale-no-photo", 31);
    await saveDraft("wizard:fresh", { note: "keep" });

    await dispatchCleanup();

    await waitFor(async () => {
      expect(await draftExists("wizard:stale-with-photo")).toBe(false);
    });
    expect(await draftExists("wizard:stale-no-photo")).toBe(false);
    expect(await draftExists("wizard:fresh")).toBe(true);
    expect(providerA.keys()).not.toContain(key);
  });

  test("resolves each stale row's own tenant provider — never the job's SYSTEM_TENANT_ID run-tenant, never another row's tenant", async () => {
    const keyA = "tenant-a/vehicle/photo-a.jpg";
    const keyB = "tenant-b/vehicle/photo-b.jpg";
    await providerA.write(keyA, new Uint8Array([1]), "image/jpeg");
    await providerB.write(keyB, new Uint8Array([2]), "image/jpeg");
    await seedFileRef(keyA, owner);
    await seedFileRef(keyB, ownerTenantB);

    await saveDraft("wizard:tenant-a-stale", { photo: fileRefPointer(keyA) }, owner);
    await backdate("wizard:tenant-a-stale", 31);
    await saveDraft("wizard:tenant-b-stale", { photo: fileRefPointer(keyB) }, ownerTenantB);
    await backdate("wizard:tenant-b-stale", 31);

    await dispatchCleanup();

    await waitFor(async () => {
      expect(await draftExists("wizard:tenant-a-stale")).toBe(false);
    });
    await waitFor(async () => {
      expect(await draftExists("wizard:tenant-b-stale")).toBe(false);
    });

    expect(providerA.keys()).not.toContain(keyA);
    expect(providerB.keys()).not.toContain(keyB);
    // Cross-tenant guard: neither key ever lands in the other tenant's provider.
    expect(providerA.keys()).not.toContain(keyB);
    expect(providerB.keys()).not.toContain(keyA);
  });

  test("does NOT release a storageKey with no owned file_refs row (forged draft value)", async () => {
    const forgedKey = "tenant-a/vehicle/victim.jpg";
    await providerA.write(forgedKey, new Uint8Array([9, 9, 9]), "image/jpeg");
    // Deliberately no seedFileRef — the stale draft's `values` claims a
    // storageKey its owner never actually uploaded.

    await saveDraft("wizard:stale-forged", { photo: fileRefPointer(forgedKey) });
    await backdate("wizard:stale-forged", 31);

    await dispatchCleanup();

    await waitFor(async () => {
      expect(await draftExists("wizard:stale-forged")).toBe(false);
    });
    expect(providerA.keys()).toContain(forgedKey);
  });

  test("does NOT release a storageKey whose file_refs row predates the draft (entity-prefilled edit-mode value, fw-review #5)", async () => {
    const key = "tenant-a/vehicle/prefilled.jpg";
    await providerA.write(key, new Uint8Array([1, 2, 3]), "image/jpeg");
    await seedFileRef(key);
    // The photo was uploaded when the domain entity was originally created —
    // long before this editing session's draft. backdate() (below) also
    // ages the draft row to 31 days, so the file must be aged further still
    // to model "predates the draft" rather than "same moment".
    await backdateFileRef(key, 60);

    await saveDraft("wizard:stale-with-prefilled-photo", { photo: fileRefPointer(key) });
    await backdate("wizard:stale-with-prefilled-photo", 31);

    await dispatchCleanup();

    await waitFor(async () => {
      expect(await draftExists("wizard:stale-with-prefilled-photo")).toBe(false);
    });
    // The live domain entity this draft was editing still references `key`.
    expect(providerA.keys()).toContain(key);
  });
});
