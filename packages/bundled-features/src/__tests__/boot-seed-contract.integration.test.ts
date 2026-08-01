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
import { createTemplateResolverFeature } from "../template-resolver/feature";
import { seedTextBlock } from "../template-resolver/seeding";
import {
  type TemplateResourceRow,
  templateResourceEntity,
  templateResourcesTable,
} from "../template-resolver/table";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createTemplateResolverFeature(), createComplianceProfilesFeature()],
  });
  await unsafeCreateEntityTable(stack.db, templateResourceEntity);
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
      locale: "de",
      title: "Impressum",
      content: "seed body",
    });
    await seedTextBlock(stack.db, {
      tenantId,
      slug: "imprint",
      locale: "de",
      title: "Impressum (edited)",
      content: "admin body",
      ifExists: "update",
    });
    await seedTextBlock(stack.db, {
      tenantId,
      slug: "imprint",
      locale: "de",
      title: "Impressum",
      content: "seed body",
    });

    const row = await fetchOne<TemplateResourceRow>(stack.db, templateResourcesTable, {
      tenantId,
      slug: "imprint",
      locale: "de",
    });
    expect(row).toMatchObject({ title: "Impressum (edited)", content: "admin body", version: 2 });

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
