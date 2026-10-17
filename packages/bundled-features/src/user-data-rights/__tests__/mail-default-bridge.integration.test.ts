// C6 Autonomie-Beweis: mountet user-data-rights OHNE send*Email-Opts +
// mail-foundation + mail-transport-inmemory, und treibt den ECHTEN
// registrierten Forget-Cron durch einen echten Job-Kontext — `configResolver`
// gesetzt (App-Override provider=inmemory), KEIN per-request `config`.
//
// Das beweist die kritische Naht: der Cron baut den per-Tenant-Mail-Transport
// aus `ctx.configResolver` (makeTenantMailTransportResolver). Ein hand-
// gefuetterter Callback oder Fake-Resolver wuerde genau diese Bruecke
// ueberspringen (vgl. project_export_cron_config_accessor_fix). Akzeptanz von
// #624: "App mountet mail-foundation+transport → GDPR-Mails ohne Callback-Code".

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { asRawClient, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { isPiiCiphertext } from "@cosmicdrift/kumiko-framework/crypto";
import { createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetTestTables, seedRow } from "@cosmicdrift/kumiko-framework/testing";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { localeDe } from "@cosmicdrift/kumiko-locale-de";
import {
  authMailRendererFeatures,
  seedAuthMailTemplates,
} from "../../auth-email-password/__tests__/auth-mail-stack.js";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.js";
import {
  configValuesTable,
  createConfigFeature,
  createConfigResolver,
} from "../../config/index.js";
import {
  createDataRetentionFeature,
  tenantRetentionOverrideEntity,
} from "../../data-retention/index.js";
import { createFilesFeature } from "../../files/index.js";
import { mailFoundationFeature } from "../../mail-foundation/index.js";
import {
  clearInbox,
  getInbox,
  mailTransportInMemoryFeature,
} from "../../mail-transport-inmemory/index.js";
import { createSessionsFeature, userSessionEntity } from "../../sessions/index.js";
import { tenantMembershipEntity, tenantMembershipsTable } from "../../tenant/membership-table.js";
import { createUserFeature, USER_STATUS, userEntity, userTable } from "../../user/index.js";
import { createUserDataRightsDefaultsFeature } from "../../user-data-rights-defaults/index.js";
import { createUserDataRightsFeature } from "../feature.js";
import {
  emailsIn,
  expectEmailsShredded,
  setupSubjectKmsForTest,
} from "./forget-shredding-test-helpers.js";

const TENANT_A = "00000000-0000-4000-8000-0000000006a1";
const TENANT_SYSTEM = SYSTEM_TENANT_ID;
const USER_ID = "00000000-0000-4000-8000-0000000006b1";
const ORIGINAL_EMAIL = "bridge-delete@example.test";
const FORGET_JOB = "user-data-rights:job:run-forget-cleanup";

// App-weiter Override (wie money-horse's Config-Resolver): provider=inmemory
// ohne per-Tenant-config-Row. Der Job-Kontext traegt DIESEN resolver, kein config.
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
      authFoundationFeature,
      createSessionsFeature(),
      mailFoundationFeature,
      mailTransportInMemoryFeature,
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
    await seedRow(stack.db, userTable, {
      id: USER_ID,
      tenantId: TENANT_SYSTEM,
      email: ORIGINAL_EMAIL,
      passwordHash: "hashed",
      displayName: "Bridge Delete",
      locale: "de",
      emailVerified: true,
      roles: '["Member"]',
      status: USER_STATUS.DeletionRequested,
      gracePeriodEnd: past(),
    });
    await seedRow(stack.db, tenantMembershipsTable, {
      tenantId: TENANT_A,
      userId: USER_ID,
      roles: '["Member"]',
    });

    const job = stack.registry.getJob(FORGET_JOB);
    expect(job).toBeDefined();

    // EXAKT der prod-Job-Kontext: configResolver gesetzt, config undefined.
    // log required since #1572 persists incomplete[] via ctx.log.warn.
    const jobCtx = {
      db: createTenantDb(stack.db, TENANT_A, "tenant", undefined, undefined, undefined, {
        unsafeRaw: { reason: "executes overdue Art.17 forget requests across every tenant" },
      }),
      registry: stack.registry,
      configResolver,
      systemUser: createSystemUser(TENANT_A),
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
    await job?.handler({}, jobCtx as never);

    // Loeschung lief autonom durch.
    const rows = (await asRawClient(stack.db).unsafe(
      "SELECT status, email FROM read_users WHERE id = $1",
      [USER_ID],
    )) as unknown as { rows?: Array<{ status: string; email: string }> };
    const userRow = (rows.rows ?? (rows as unknown as Array<{ status: string; email: string }>))[0];
    expect(userRow?.status).toBe(USER_STATUS.Deleted);

    // Die Default-Mail wurde ueber den aus configResolver gebauten inmemory-
    // Transport versendet — keine App-seitige Callback-Verdrahtung.
    const inbox = getInbox(TENANT_A);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.to).toBe(ORIGINAL_EMAIL);
    // Der User ist mit locale="de" geseedet → die Default-Mail rendert DEUTSCH
    // (per-recipient locale, KEIN App-Callback). Vorher rendete sie still en —
    // der Advisor-Befund, den dieser Assert jetzt einfaengt.
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
    // Pinnt dass der Stack den inmemory-Transport registriert hat (sonst waere
    // der obige Beweis vacuously true: ohne mailTransport-Usage greift die
    // Default gar nicht).
    expect(stack.registry.getExtensionUsages("mailTransport").map((u) => u.entityName)).toContain(
      "inmemory",
    );
  });
});
