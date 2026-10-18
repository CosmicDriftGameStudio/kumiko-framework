// With delivery + channel-email mounted, the deletion-executed default mail goes through
// the email channel like every other GDPR mail. A tenant that never picked a mail
// provider of its own still gets the confirmation over the app transport, and the
// send leaves no delivery-attempt row behind (the user is already erased).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { localeDe } from "@cosmicdrift/kumiko-locale-de";
import { resetTestTables, seedRow } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  authMailRendererFeatures,
  seedAuthMailTemplates,
} from "../../auth-email-password/__tests__/auth-mail-stack.js";
import { createChannelEmailFeature, createInMemoryTransport } from "../../channel-email/index.js";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.js";
import {
  configValuesTable,
  createConfigAccessorFactory,
  createConfigFeature,
  createConfigResolver,
} from "../../config/index.js";
import {
  createDataRetentionFeature,
  tenantRetentionOverrideEntity,
} from "../../data-retention/index.js";
import { createDeliveryFeature, createDeliveryTestContext } from "../../delivery/index.js";
import { deliveryAttemptsTable, notificationPreferencesTable } from "../../delivery/tables.js";
import { createFilesFeature } from "../../files/index.js";
import { createMailFoundationFeature, tenantMailTransport } from "../../mail-foundation/index.js";
import {
  clearInbox,
  createMailTransportInMemoryFeature,
  getInbox,
} from "../../mail-transport-inmemory/index.js";
import { createSessionsFeature, userSessionEntity } from "../../sessions/index.js";
import { createTenantFeature } from "../../tenant/index.js";
import { tenantMembershipEntity, tenantMembershipsTable } from "../../tenant/membership-table.js";
import { createUserFeature, USER_STATUS, userEntity, userTable } from "../../user/index.js";
import { createUserDataRightsDefaultsFeature } from "../../user-data-rights-defaults/index.js";
import { createUserDataRightsFeature } from "../feature.js";
import { setupSubjectKmsForTest } from "./forget-shredding-test-helpers.js";

const TENANT_WITHOUT_PROVIDER = "00000000-0000-4000-8000-0000000007a1";
const USER_ID = "00000000-0000-4000-8000-0000000007b1";
const ORIGINAL_EMAIL = "channel-delete@example.test";
const FORGET_JOB = "user-data-rights:job:run-forget-cleanup";

const appTransport = createInMemoryTransport();
// No provider override and no tenant row: the tenant has no mail provider of its own.
const configResolver = createConfigResolver();

let stack: TestStack;
setupSubjectKmsForTest();

type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;
const past = (): Instant => getTemporal().Instant.fromEpochMilliseconds(Date.now() - 60_000);

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createFilesFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createAuthFoundationFeature(),
      createSessionsFeature(),
      createMailFoundationFeature(),
      createMailTransportInMemoryFeature(),
      ...authMailRendererFeatures(),
      createDeliveryFeature(),
      createChannelEmailFeature({
        transport: appTransport,
        tenantTransport: tenantMailTransport,
        resolveEmail: async () => null,
      }),
      createUserDataRightsFeature(),
      localeDe(),
      createUserDataRightsDefaultsFeature(),
    ],
    extraContext: (deps) => ({
      ...createDeliveryTestContext(deps),
      configResolver,
      _configAccessorFactory: createConfigAccessorFactory(deps.registry, configResolver),
    }),
  });

  await unsafePushTables(stack.db, {
    configValuesTable,
    notificationPreferencesTable,
    deliveryAttemptsTable,
  });
  await seedAuthMailTemplates(stack);
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, userSessionEntity);
  await unsafeCreateEntityTable(stack.db, tenantRetentionOverrideEntity);
  await unsafeCreateEntityTable(stack.db, tenantMembershipEntity);
  await unsafePushTables(stack.db, { fileRefsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [
    userTable,
    "read_tenant_memberships",
    fileRefsTable,
    eventsTable,
    deliveryAttemptsTable,
  ]);
  appTransport.sent.length = 0;
  clearInbox(TENANT_WITHOUT_PROVIDER);
});

describe("deletion-executed default mail through the email channel", () => {
  test("a tenant without its own mail provider gets the mail over the app transport, with no attempt row", async () => {
    await seedRow(stack.db, userTable, {
      id: USER_ID,
      tenantId: SYSTEM_TENANT_ID,
      email: ORIGINAL_EMAIL,
      passwordHash: "hashed",
      displayName: "Channel Delete",
      locale: "de",
      emailVerified: true,
      roles: '["Member"]',
      status: USER_STATUS.DeletionRequested,
      gracePeriodEnd: past(),
    });
    await seedRow(stack.db, tenantMembershipsTable, {
      tenantId: TENANT_WITHOUT_PROVIDER,
      userId: USER_ID,
      roles: '["Member"]',
    });

    const job = stack.registry.getJob(FORGET_JOB);
    expect(job).toBeDefined();
    const jobCtx = {
      db: createTenantDb({
        db: stack.db,
        tenantId: TENANT_WITHOUT_PROVIDER,
        mode: "tenant",
        grants: {
          unsafeRaw: { reason: "executes overdue Art.17 forget requests across every tenant" },
        },
      }),
      registry: stack.registry,
      configResolver,
      systemUser: createSystemUser(TENANT_WITHOUT_PROVIDER),
      log: {
        info() {},
        warn() {},
        error() {},
        debug() {},
        child() {
          return this;
        },
      },
    };
    await job?.handler({}, jobCtx as never); // @cast-boundary hand-built job context, as in mail-default-bridge

    expect(appTransport.sent.map((message) => message.to)).toEqual([ORIGINAL_EMAIL]);
    expect(appTransport.sent[0]?.subject).toContain("Dein Konto wurde gelöscht");
    expect(getInbox(TENANT_WITHOUT_PROVIDER)).toHaveLength(0);
    expect(await selectMany(stack.db, deliveryAttemptsTable, {})).toHaveLength(0);
  });
});
