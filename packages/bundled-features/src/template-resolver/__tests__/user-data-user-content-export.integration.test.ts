// The user export reaches a user's own `user-content-entry` rows through the real runner (runUserExport),
// decrypted, and neither a colleague's entries nor the user's entries in a tenant without membership.
// Encryption is part of the setup: without a KMS the fields would be stored as plaintext and the test
// would not prove that the export hook decrypts.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import {
  resetPiiSubjectKmsForTests,
  seedRowViaEventStore,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.ts";
import {
  createDataRetentionFeature,
  tenantRetentionOverrideEntity,
} from "../../data-retention/index.ts";
import { createSessionsFeature } from "../../sessions/index.ts";
import { tenantMembershipEntity, tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { createUserFeature, USER_STATUS, userEntity, userTable } from "../../user/index.ts";
import { createUserDataRightsFeature } from "../../user-data-rights/index.ts";
import { runUserExport } from "../../user-data-rights/run-user-export.ts";
import { createTemplateResolverFeature } from "../feature.ts";
import { templateResourceEntity } from "../table.ts";
import {
  type UserContentEntryRow,
  userContentEntriesTable,
  userContentEntryEntity,
} from "../user-content-table.ts";
import { collectionHandlerName } from "../web/qualified-names.ts";

const OTHER_TENANT = "00000000-0000-4000-8000-0000000000fe" as TenantId;
const owner = createTestUser({ id: 21, roles: ["Agent"] });
const colleague = createTestUser({ id: 22, roles: ["Agent"] });
const ownerElsewhere = createTestUser({ id: 21, roles: ["Agent"], tenantId: OTHER_TENANT });

const SIGNATURES_SET = collectionHandlerName("signatures");

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createUserFeature(),
      createAuthFoundationFeature(),
      createSessionsFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createUserDataRightsFeature(),
      createTemplateResolverFeature({
        collections: [
          {
            id: "signatures",
            kind: "document-pdf",
            contentFormat: "document",
            ownership: "user",
            access: { roles: ["Agent"] },
            nav: { label: "mail:nav.signatures" },
          },
        ],
      }),
    ],
  });
  // After the stack: the stack setup can reset the KMS, which would leave the fields in plaintext.
  configurePiiSubjectKms(new InMemoryKmsAdapter());
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantMembershipEntity);
  await unsafeCreateEntityTable(stack.db, tenantRetentionOverrideEntity);
  await unsafeCreateEntityTable(stack.db, templateResourceEntity);
  await unsafeCreateEntityTable(stack.db, userContentEntryEntity);
});

afterAll(async () => {
  resetPiiSubjectKmsForTests();
  await stack.cleanup();
});

const entryOf = (title: string, content: string) => ({
  slug: "standard",
  locale: "de",
  title,
  folder: "kunden",
  content,
  contentFormat: "html" as const,
});

describe("user export :: user-content-entry", () => {
  test("exports the owner's own entries decrypted, and nobody else's", async () => {
    await seedRowViaEventStore(stack.db, userTable, {
      id: owner.id,
      email: "owner@example.com",
      passwordHash: "hashed",
      displayName: "Owner",
      locale: "de",
      emailVerified: true,
      roles: '["Agent"]',
      status: USER_STATUS.Active,
    });
    await seedRowViaEventStore(stack.db, tenantMembershipsTable, {
      tenantId: owner.tenantId,
      userId: owner.id,
      roles: '["Agent"]',
    });

    await stack.http.writeOk(
      SIGNATURES_SET,
      entryOf("Signatur Weber", "<p>Viele Grüße, Weber</p>"),
      owner,
    );
    await stack.http.writeOk(
      SIGNATURES_SET,
      entryOf("Signatur Kollege", "<p>Gruß, Kollege</p>"),
      colleague,
    );
    await stack.http.writeOk(
      SIGNATURES_SET,
      entryOf("Signatur Fremdmandant", "<p>Gruß, fremd</p>"),
      ownerElsewhere,
    );
    await stack.eventDispatcher?.runOnce();

    const bundle = await runUserExport({
      db: stack.db,
      registry: stack.registry,
      userId: owner.id,
      now: getTemporal().Now.instant(),
    });

    const rows = bundle.tenants
      .find((t) => t.tenantId === owner.tenantId)
      ?.entities.find((e) => e.entity === "user-content-entry")?.rows;
    expect(rows).toHaveLength(1);
    expect(rows?.[0]).toMatchObject({
      slug: "standard",
      kind: "document-pdf",
      locale: "de",
      title: "Signatur Weber",
      folder: "kunden",
      content: "<p>Viele Grüße, Weber</p>",
    });
    expect(bundle.tenants.some((t) => t.tenantId === OTHER_TENANT)).toBe(false);

    const stored = await selectMany<UserContentEntryRow>(stack.db, userContentEntriesTable, {
      ownerId: owner.id,
      slug: "standard",
    });
    expect(stored.find((r) => r.tenantId === owner.tenantId)?.title).not.toBe("Signatur Weber");

    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain("Signatur Kollege");
    expect(serialized).not.toContain("Signatur Fremdmandant");
  });
});
