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
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetTestTables, seedRow } from "@cosmicdrift/kumiko-framework/testing";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { createComplianceProfilesFeature } from "../../compliance-profiles";
import { configValuesTable, createConfigFeature, createConfigResolver } from "../../config";
import { createDataRetentionFeature, tenantRetentionOverrideEntity } from "../../data-retention";
import { createFilesFeature } from "../../files";
import { mailFoundationFeature } from "../../mail-foundation";
import { clearInbox, getInbox, mailTransportInMemoryFeature } from "../../mail-transport-inmemory";
import { createSessionsFeature, userSessionEntity } from "../../sessions";
import { createUserFeature, USER_STATUS, userEntity, userTable } from "../../user";
import { createUserDataRightsDefaultsFeature } from "../../user-data-rights-defaults";
import { createUserDataRightsFeature } from "../feature";

const TENANT_A = "00000000-0000-4000-8000-0000000006a1";
const TENANT_SYSTEM = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-0000000006b1";
const ORIGINAL_EMAIL = "bridge-delete@example.test";
const FORGET_JOB = "user-data-rights:job:run-forget-cleanup";

// App-weiter Override (wie money-horse's Config-Resolver): provider=inmemory
// ohne per-Tenant-config-Row. Der Job-Kontext traegt DIESEN resolver, kein config.
const configResolver = createConfigResolver({
  appOverrides: new Map([["mail-foundation:config:provider", "inmemory"]]),
});

let stack: TestStack;

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
      createSessionsFeature(),
      mailFoundationFeature,
      mailTransportInMemoryFeature,
      // KEINE send*Email-Opts — die mail-foundation-Defaults muessen greifen.
      createUserDataRightsFeature(),
      createUserDataRightsDefaultsFeature(),
    ],
  });

  await unsafePushTables(stack.db, { configValuesTable });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, userSessionEntity);
  await unsafeCreateEntityTable(stack.db, tenantRetentionOverrideEntity);
  await asRawClient(stack.db).unsafe(`
    CREATE TABLE IF NOT EXISTS read_tenant_memberships (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL,
      user_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0,
      inserted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      modified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      inserted_by_id TEXT,
      modified_by_id TEXT,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      deleted_at TIMESTAMPTZ,
      deleted_by_id TEXT,
      roles TEXT NOT NULL DEFAULT '[]',
      UNIQUE(user_id, tenant_id)
    )
  `);
  await unsafePushTables(stack.db, { fileRefsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [userTable, "read_tenant_memberships", fileRefsTable]);
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
    await asRawClient(stack.db).unsafe(
      `INSERT INTO read_tenant_memberships (tenant_id, user_id, roles) VALUES ($1, $2, '["Member"]')`,
      [TENANT_A, USER_ID],
    );

    const job = stack.registry.getJob(FORGET_JOB);
    expect(job).toBeDefined();

    // EXAKT der prod-Job-Kontext: configResolver gesetzt, config undefined.
    const jobCtx = { db: stack.db, registry: stack.registry, configResolver };
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
    expect(inbox[0]?.subject).toContain("Dein Konto wurde geloescht");
    expect(inbox[0]?.html).toContain("endgueltig");
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
