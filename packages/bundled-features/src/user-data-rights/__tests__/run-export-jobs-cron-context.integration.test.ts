// Treibt den ECHTEN registrierten Export-Cron-Job (r.job "run-export-jobs")
// über seinen Job-Kontext — so wie der Job-Runner ihn in prod aufruft:
// `ctx.configResolver` gesetzt (App-Override provider=inmemory), aber KEIN
// per-request `ctx.config` (das baut nur der HTTP-Dispatcher).
//
// Der bestehende run-export-jobs-Test reicht `buildStorageProvider` MANUELL —
// und übersprang damit genau diesen Pfad: der Wrapper baut providerCtx aus dem
// Job-Kontext. Ohne den configResolver→ConfigAccessor-Bau wirft
// createFileProviderForTenant "ctx.config is missing" (genau der prod-Bug, der
// jeden Export auf "failed" setzte).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { asRawClient, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  type JobContext,
  SYSTEM_USER_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { registerMailTranslations } from "@cosmicdrift/kumiko-framework/i18n";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { seedRow } from "@cosmicdrift/kumiko-framework/testing";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { localeDeBundle } from "@cosmicdrift/kumiko-locale-de";
import {
  authMailRendererFeatures,
  seedAuthMailTemplates,
} from "../../auth-email-password/__tests__/auth-mail-stack.js";
import { createChannelEmailFeature } from "../../channel-email/feature.js";
import { createInMemoryTransport } from "../../channel-email/types.js";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/index.js";
import {
  configValuesTable,
  createConfigFeature,
  createConfigResolver,
} from "../../config/index.js";
import { createDataRetentionFeature } from "../../data-retention/index.js";
import { createDeliveryFeature, createDeliveryTestContext } from "../../delivery/index.js";
import { deliveryAttemptsTable, notificationPreferencesTable } from "../../delivery/tables.js";
import { fileFoundationFeature } from "../../file-foundation/index.js";
import { fileProviderInMemoryFeature } from "../../file-provider-inmemory/index.js";
import { createSessionsFeature } from "../../sessions/index.js";
import { createTenantFeature } from "../../tenant/feature.js";
import { createUserFeature, USER_STATUS, userEntity, userTable } from "../../user/index.js";
import { createUserDataRightsFeature } from "../feature.js";
import { exportDownloadTokenEntity } from "../schema/download-token.js";
import { EXPORT_JOB_STATUS, exportJobEntity, exportJobsTable } from "../schema/export-job.js";

const TENANT = "00000000-0000-4000-8000-0000000009a1";
const USER_ID = "00000000-0000-4000-8000-0000000009b1";
const JOB_QN = "user-data-rights:job:run-export-jobs";

// App-weiter Override wie money-horse's cashColtConfigResolver — provider=inmemory
// ohne per-Tenant-config-Row. Der Job-Kontext trägt DIESEN resolver, kein config.
const configResolver = createConfigResolver({
  appOverrides: new Map([["file-foundation:config:provider", "inmemory"]]),
});

const EXPORT_DOWNLOAD_URL = "https://app.test/user-export/by-token";

const emailTransport = createInMemoryTransport();
const RECIPIENT_EMAIL = "export-cron@example.test";

let stack: TestStack;
let notifyFactory: unknown;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createUserFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      fileFoundationFeature,
      fileProviderInMemoryFeature,
      ...authMailRendererFeatures(),
      createDeliveryFeature(),
      createChannelEmailFeature({
        transport: emailTransport,
        resolveEmail: async () => RECIPIENT_EMAIL,
      }),
      authFoundationFeature,
      createSessionsFeature(),
      // appExportDownloadUrl set → the default export-ready mail is enabled, so
      // this also proves the export cron's mail bridge end-to-end (C6).
      createUserDataRightsFeature({ appExportDownloadUrl: EXPORT_DOWNLOAD_URL }),
    ],
    extraContext: (deps) => {
      const delivery = createDeliveryTestContext(deps);
      notifyFactory = delivery["_notifyFactory"];
      return delivery;
    },
  });
  await unsafePushTables(stack.db, { configValuesTable, notificationPreferencesTable });
  await seedAuthMailTemplates(stack);
  await unsafeCreateEntityTable(stack.db, exportJobEntity);
  await unsafeCreateEntityTable(stack.db, exportDownloadTokenEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(stack.db, userEntity);
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
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  const raw = asRawClient(stack.db);
  await raw.unsafe("DELETE FROM read_export_jobs");
  await raw.unsafe("DELETE FROM read_users");
  await raw.unsafe("DELETE FROM read_tenant_memberships");
  await seedRow(stack.db, userTable, {
    id: USER_ID,
    tenantId: TENANT,
    email: RECIPIENT_EMAIL,
    passwordHash: "hashed",
    displayName: "Cron Export",
    locale: "de",
    emailVerified: true,
    roles: '["Member"]',
    status: USER_STATUS.Active,
  });
  await raw.unsafe(
    `INSERT INTO read_tenant_memberships (tenant_id, user_id, roles) VALUES ('${TENANT}', '${USER_ID}', '["Member"]')`,
  );
  emailTransport.sent.length = 0;
});

// Seedet einen pending Export-Job über den echten request-export-Handler.
async function seedPendingJob(): Promise<string> {
  const res = await stack.http.writeOk<{ jobId: string }>(
    "user-data-rights:write:request-export",
    {},
    { id: USER_ID, tenantId: TENANT, roles: ["Member"] },
  );
  return res.jobId;
}

registerMailTranslations("de", localeDeBundle);

// Serialized rows of the stores a mail send could leak into: the event store
// and the delivery attempt log (no job row is written on the immediate path).
async function persistedDeliveryTraces(): Promise<string> {
  const rows = [
    ...(await selectMany(stack.db, eventsTable, {})),
    ...(await selectMany(stack.db, deliveryAttemptsTable, {})),
  ];
  return JSON.stringify(rows, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
}

describe("run-export-jobs cron-context", () => {
  test("Cron-Job-Kontext (configResolver, KEIN config) → Export läuft durch, bytesWritten > 0", async () => {
    const jobId = await seedPendingJob();
    const job = stack.registry.getJob(JOB_QN);
    expect(job).toBeDefined();

    // EXAKT der prod-Job-Kontext: configResolver gesetzt, config undefined.
    const jobCtx = {
      db: createTenantDb(stack.db, TENANT, "tenant", undefined, undefined, undefined, {
        unsafeRaw: { reason: "processes pending export jobs across every tenant" },
      }),
      registry: stack.registry,
      configResolver,
      _notifyFactory: notifyFactory,
      _userId: SYSTEM_USER_ID,
      systemUser: createSystemUser(TENANT),
      now: getTemporal().Now.instant(),
    };
    // Vor dem Fix wirft der Wrapper hier "ctx.config is missing".
    // jobCtx is a deliberately minimal prod-context replica (missing
    // log/triggeredBy) — double-cast at this test boundary since the
    // handler under test never touches those fields.
    await job?.handler({}, jobCtx as unknown as JobContext);

    const [row] = (await selectMany(stack.db, exportJobsTable, { id: jobId })) as Array<{
      status: string;
      bytesWritten: number | null;
      errorMessage: string | null;
    }>;
    expect(row?.errorMessage).toBeNull();
    expect(row?.status).toBe(EXPORT_JOB_STATUS.Done);
    expect(row?.bytesWritten ?? 0).toBeGreaterThan(0);

    // The real export cron sends the default export-ready mail through
    // ctx._notifyFactory and delivery, without an app callback.
    // user.locale="de" gives the German subject; downloadUrl carries the magic link.
    expect(emailTransport.sent).toHaveLength(1);
    expect(emailTransport.sent[0]?.to).toBe(RECIPIENT_EMAIL);
    expect(emailTransport.sent[0]?.subject).toContain("Dein Datenexport ist bereit");
    expect(emailTransport.sent[0]?.html).toContain(EXPORT_DOWNLOAD_URL);

    // The plain magic-link token and the plain address stay out of events
    // and delivery attempts.
    // The mail renderer HTML-escapes "=" in the link as "&#x3D;".
    const token = /#token(?:=|&#x3D;)([^&"'\s<]+)/.exec(emailTransport.sent[0]?.html ?? "")?.[1];
    expect(token).toBeDefined();
    const traces = await persistedDeliveryTraces();
    expect(traces).not.toContain(token ?? "");
    expect(traces).not.toContain(RECIPIENT_EMAIL);
  });
});
