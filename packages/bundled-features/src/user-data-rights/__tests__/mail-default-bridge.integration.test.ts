// Autonomy proof: mounts user-data-rights WITHOUT send*Email options +
// mail-foundation + mail-transport-inmemory, and drives the REAL registered
// Forget cron through a real job context — `configResolver` is set (app override
// provider=inmemory), with NO per-request `config`.
//
// This proves the critical seam: the cron builds the per-tenant mail transport
// from `ctx.configResolver` (makeTenantMailTransportResolver). A hand-wired
// callback or fake resolver would bypass exactly this bridge. The app mounts
// mail-foundation+transport, so GDPR emails work without callback code.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";

import { isPiiCiphertext } from "@cosmicdrift/kumiko-framework/crypto";
import { asRawClient, createTenantDb, selectMany } from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { localeDe } from "@cosmicdrift/kumiko-locale-de";
import { resetTestTables, seedRowViaEventStore } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  authMailRendererFeatures,
  seedAuthMailTemplates,
} from "../../auth-email-password/__tests__/auth-mail-stack.ts";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.ts";
import {
  configValuesTable,
  createConfigFeature,
  createConfigResolver,
} from "../../config/index.ts";
import {
  createDataRetentionFeature,
  tenantRetentionOverrideEntity,
} from "../../data-retention/index.ts";
import { createFilesFeature } from "../../files/index.ts";
import { createMailFoundationFeature } from "../../mail-foundation/index.ts";
import {
  clearInbox,
  createMailTransportInMemoryFeature,
  getInbox,
} from "../../mail-transport-inmemory/index.ts";
import { createSessionsFeature, userSessionEntity } from "../../sessions/index.ts";
import { tenantMembershipEntity, tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { createUserFeature, USER_STATUS, userEntity, userTable } from "../../user/index.ts";
import { createUserDataRightsDefaultsFeature } from "../../user-data-rights-defaults/index.ts";
import { createUserDataRightsFeature } from "../feature.ts";
import { UserDataRightsJobs } from "../web/constants.ts";
import {
  emailsIn,
  expectEmailsShredded,
  setupSubjectKmsForTest,
} from "./forget-shredding-test-helpers.ts";

const TENANT_A = "00000000-0000-4000-8000-0000000006a1";
const USER_ID = "00000000-0000-4000-8000-0000000006b1";
const ORIGINAL_EMAIL = "bridge-delete@example.test";
const FORGET_JOB = UserDataRightsJobs.runForgetCleanup;

// App-wide override (like money-horse's config resolver): provider=inmemory
// without a per-tenant config row. The job context carries THIS resolver, not config.
const configResolver = createConfigResolver({
  appOverrides: new Map([["mail-foundation:config:provider", "inmemory"]]),
});

let stack: TestStack;
const getKms = setupSubjectKmsForTest();

type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;
const past = (): Instant => getTemporal().Instant.fromEpochMilliseconds(Date.now() - 60_000);

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createFilesFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createAuthFoundationFeature(),
      createSessionsFeature(),
      createMailFoundationFeature(),
      createMailTransportInMemoryFeature(),
      ...authMailRendererFeatures(),
      // KEINE send*Email-Opts — die mail-foundation-Defaults muessen greifen.
      createUserDataRightsFeature(),
      localeDe(),
      createUserDataRightsDefaultsFeature(),
    ],
  });

  await unsafePushTables(stack.db, { configValuesTable });
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
  ]);
  clearInbox(TENANT_A);
});

describe("C6 default mail bridge :: forget cron sends deletion-executed without app callback", () => {
  test("registered cron + configResolver(provider=inmemory) → user deleted + mail in inbox", async () => {
    await seedRowViaEventStore(stack.db, userTable, {
      id: USER_ID,
      email: ORIGINAL_EMAIL,
      passwordHash: "hashed",
      displayName: "Bridge Delete",
      locale: "de",
      emailVerified: true,
      roles: '["Member"]',
      status: USER_STATUS.DeletionRequested,
      gracePeriodEnd: past(),
    });
    await seedRowViaEventStore(stack.db, tenantMembershipsTable, {
      tenantId: TENANT_A,
      userId: USER_ID,
      roles: '["Member"]',
    });

    const job = stack.registry.getJob(FORGET_JOB);
    expect(job).toBeDefined();

    // EXACT production job context: configResolver set, config undefined.
    // Logging is required because incomplete[] is persisted via ctx.obs.log.warn.
    const jobCtx = {
      db: createTenantDb({
        db: stack.db,
        tenantId: TENANT_A,
        mode: "tenant",
        grants: {
          unsafeRaw: { reason: "executes overdue Art.17 forget requests across every tenant" },
        },
      }),
      registry: stack.registry,
      configResolver,
      systemUser: createSystemUser(TENANT_A),
      obs: {
        log: {
          info() {},
          warn() {},
          error() {},
          debug() {},
          child() {
            return this;
          },
        },
      },
    };
    await job?.handler({}, jobCtx as never);

    // Loeschung lief autonom durch.
    const rows = (await asRawClient(stack.db).unsafe(
      "SELECT status, email FROM read_users WHERE id = $1",
      [USER_ID],
    )) as unknown as { rows?: Array<{ status: string; email: string }> };
    const userRow = (rows.rows ?? (rows as unknown as Array<{ status: string; email: string }>))[0];
    expect(userRow?.status).toBe(USER_STATUS.Deleted);

    // The default email was sent through the inmemory transport built from
    // configResolver — without app-side callback wiring.
    const inbox = getInbox(TENANT_A);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.to).toBe(ORIGINAL_EMAIL);
    // The user was seeded with locale="de" → the default email renders in GERMAN
    // (per-recipient locale, NO app callback). Previously it silently rendered in
    // English — the advisor finding captured by this assertion.
    expect(inbox[0]?.subject).toContain("Dein Konto wurde gelöscht");
    expect(inbox[0]?.html).toContain("endgültig");

    // No event of any aggregate carries the address in plaintext, and the user
    // aggregate keeps it only in `previous`, under the now-erased subject key.
    const events = await selectMany<{
      aggregateId: string;
      type: string;
      payload: Record<string, unknown>;
    }>(stack.db, eventsTable, {});
    const traces = JSON.stringify(events, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    expect(traces).not.toContain(ORIGINAL_EMAIL);
    const updates = events.filter(
      (event) => event.aggregateId === USER_ID && event.type === "user.updated",
    );
    expect(updates.length).toBeGreaterThan(0);

    const previousEmails = emailsIn(
      updates.map((event) => event.payload),
      "previous",
    );
    expect(previousEmails.length).toBeGreaterThan(0);
    // Later events load the already-erased row, so their `previous` carries the sentinel.
    expect(previousEmails.some((email) => isPiiCiphertext(email))).toBe(true);
    await expectEmailsShredded(previousEmails, getKms(), USER_ID);
  });

  test("no mail transport mounted is NOT this stack — sanity: provider really is inmemory", () => {
    // Pins that the stack registered the inmemory transport; otherwise the proof
    // above would be vacuously true because the default has no mailTransport usage.
    expect(stack.registry.getExtensionUsages("mailTransport").map((u) => u.entityName)).toContain(
      "inmemory",
    );
  });
});
