// fw-review #6 — form-draft declared a hard r.requires("config"), so any
// app mounting form-draft without the config feature failed at boot with
// `Feature "form-draft" requires feature "config" which is not registered`
// (registry-validate.ts). config is now r.optionalRequires: form-draft must
// boot standalone, and its cleanup job must still run — falling back to
// FORM_DRAFT_DEFAULT_RETENTION_DAYS since there's no configResolver to read
// the `form-draft:config:retention-days` override from (see
// handlers/cleanup.job.ts).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { waitFor } from "@cosmicdrift/kumiko-framework/testing";
import { FormDraftHandlers } from "../constants";
import { formDraftEntity } from "../entity";
import { formDraftFeature } from "../feature";

let stack: TestStack;
const owner = createTestUser({ id: 1, roles: ["TenantMember"] });

beforeAll(async () => {
  // No createConfigFeature() here — the whole point of this suite.
  stack = await setupTestStack({
    features: [formDraftFeature],
    jobs: { consumerLane: "worker", queueNamePrefix: `kumiko-form-draft-no-config-${Date.now()}` },
  });
  await unsafeCreateEntityTable(stack.db, formDraftEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe("DELETE FROM kumiko_events");
  await asRawClient(stack.db).unsafe("DELETE FROM read_form_drafts");
});

async function draftExists(draftKey: string): Promise<boolean> {
  const rows = await asRawClient(stack.db).unsafe(
    "SELECT 1 FROM read_form_drafts WHERE draft_key = $1",
    [draftKey],
  );
  return (rows as unknown[]).length > 0;
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

describe("form-draft mounted without the config feature", () => {
  test("boots successfully (setupTestStack does not throw)", () => {
    expect(stack).toBeDefined();
  });

  test("cleanup job still deletes drafts older than the 30-day default retention", async () => {
    await stack.http.writeOk(
      FormDraftHandlers.save,
      { draftKey: "wizard:old-no-config", values: {}, stepIndex: 0 },
      owner,
    );
    await backdate("wizard:old-no-config", 31);
    await stack.http.writeOk(
      FormDraftHandlers.save,
      { draftKey: "wizard:fresh-no-config", values: {}, stepIndex: 0 },
      owner,
    );

    if (!stack.jobRunner) throw new Error("jobRunner not wired");
    await stack.jobRunner.dispatch("form-draft:job:cleanup", {});

    await waitFor(async () => {
      expect(await draftExists("wizard:old-no-config")).toBe(false);
    });
    expect(await draftExists("wizard:fresh-no-config")).toBe(true);
  });
});
