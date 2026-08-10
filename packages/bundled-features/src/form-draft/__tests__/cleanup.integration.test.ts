// form-draft cleanup job — real Postgres + real BullMQ dispatch (via
// stack.jobRunner), no hand-fed context. Covers the #1891 acceptance
// criteria: an old draft is deleted, a fresh one survives, and the
// retention window actually comes from the config key (not a hardcoded
// constant).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
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
    }),
  });
  await unsafeCreateEntityTable(stack.db, formDraftEntity);
  await unsafePushTables(stack.db, { configValuesTable });
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe("DELETE FROM kumiko_events");
  await asRawClient(stack.db).unsafe("DELETE FROM read_form_drafts");
  await asRawClient(stack.db).unsafe("DELETE FROM read_config_values");
});

async function saveDraft(draftKey: string): Promise<void> {
  await stack.http.writeOk(
    FormDraftHandlers.save,
    { draftKey, values: { note: "x" }, stepIndex: 0 },
    owner,
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
});
