// Pins the shared boot-seed contract (DEFAULT_SEED_IF_EXISTS="skip") across
// event-sourced seed helpers. Feature-specific behaviour stays in each
// helper's own test file; here we assert cross-cutting invariants only.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/db";
import { createEventsTable, eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { createComplianceProfilesFeature } from "../compliance-profiles/feature";
import {
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../compliance-profiles/schema/profile-selection";
import { seedComplianceProfile } from "../compliance-profiles/seeding";
import { createTextContentFeature } from "../text-content/feature";
import { seedTextBlock } from "../text-content/seeding";
import { type TextBlockRow, textBlockEntity, textBlocksTable } from "../text-content/table";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createTextContentFeature(), createComplianceProfilesFeature()],
  });
  await unsafeCreateEntityTable(stack.db, textBlockEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("boot-seed contract", () => {
  test("seedTextBlock: re-boot skip preserves user edit + event count", async () => {
    const tenantId = testTenantId(301);

    await seedTextBlock(stack.db, {
      tenantId,
      slug: "imprint",
      lang: "de",
      title: "Impressum",
      body: "seed body",
    });
    await seedTextBlock(stack.db, {
      tenantId,
      slug: "imprint",
      lang: "de",
      title: "Impressum (edited)",
      body: "admin body",
      ifExists: "update",
    });
    await seedTextBlock(stack.db, {
      tenantId,
      slug: "imprint",
      lang: "de",
      title: "Impressum",
      body: "seed body",
    });

    const row = await fetchOne<TextBlockRow>(stack.db, textBlocksTable, {
      tenantId,
      slug: "imprint",
      lang: "de",
    });
    expect(row).toMatchObject({ title: "Impressum (edited)", body: "admin body", version: 2 });

    const events = await selectMany(stack.db, eventsTable, { aggregateId: String(row!.id) });
    expect(events).toHaveLength(2);
  });

  test("seedComplianceProfile: re-boot skip preserves profile + event count", async () => {
    const tenantId = testTenantId(302);

    await seedComplianceProfile(stack.db, { tenantId, profileKey: "eu-dsgvo" });
    await seedComplianceProfile(stack.db, {
      tenantId,
      profileKey: "swiss-dsg",
      ifExists: "update",
    });
    await seedComplianceProfile(stack.db, { tenantId, profileKey: "eu-dsgvo" });

    const profileRow = (await fetchOne(stack.db, tenantComplianceProfileTable, {
      tenantId,
    })) as { id: string; profileKey: string; version: number };
    expect(profileRow.profileKey).toBe("swiss-dsg");
    expect(profileRow.version).toBe(2);

    const events = await selectMany(stack.db, eventsTable, {
      aggregateId: profileRow.id,
    });
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.type)).toEqual([
      "tenant-compliance-profile.created",
      "tenant-compliance-profile.updated",
    ]);
  });

  test('seedComplianceProfile ifExists="update" overwrites existing profile', async () => {
    const tenantId = testTenantId(303);

    await seedComplianceProfile(stack.db, { tenantId, profileKey: "eu-dsgvo" });
    await seedComplianceProfile(stack.db, {
      tenantId,
      profileKey: "swiss-dsg",
      ifExists: "update",
    });

    const row = (await fetchOne(stack.db, tenantComplianceProfileTable, {
      tenantId,
    })) as { profileKey: string };
    expect(row.profileKey).toBe("swiss-dsg");
  });
});
