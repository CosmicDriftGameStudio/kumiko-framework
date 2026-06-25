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
import { asRawClient, insertOne, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { SYSTEM_USER_ID } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles";
import { configValuesTable, createConfigFeature, createConfigResolver } from "../../config";
import { createDataRetentionFeature } from "../../data-retention";
import { fileFoundationFeature } from "../../file-foundation";
import { fileProviderInMemoryFeature } from "../../file-provider-inmemory";
import { mailFoundationFeature } from "../../mail-foundation";
import { clearInbox, getInbox, mailTransportInMemoryFeature } from "../../mail-transport-inmemory";
import { createSessionsFeature } from "../../sessions";
import { createUserFeature, USER_STATUS, userEntity, userTable } from "../../user";
import { createUserDataRightsFeature } from "../feature";
import { exportDownloadTokenEntity } from "../schema/download-token";
import { EXPORT_JOB_STATUS, exportJobEntity, exportJobsTable } from "../schema/export-job";

const TENANT = "00000000-0000-4000-8000-0000000009a1";
const USER_ID = "00000000-0000-4000-8000-0000000009b1";
const JOB_QN = "user-data-rights:job:run-export-jobs";

// App-weiter Override wie money-horse's cashColtConfigResolver — provider=inmemory
// ohne per-Tenant-config-Row. Der Job-Kontext trägt DIESEN resolver, kein config.
const configResolver = createConfigResolver({
  appOverrides: new Map([
    ["file-foundation:config:provider", "inmemory"],
    ["mail-foundation:config:provider", "inmemory"],
  ]),
});

const EXPORT_DOWNLOAD_URL = "https://app.test/user-export/by-token";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      fileFoundationFeature,
      fileProviderInMemoryFeature,
      mailFoundationFeature,
      mailTransportInMemoryFeature,
      createSessionsFeature(),
      // appExportDownloadUrl set → the default export-ready mail is enabled, so
      // this also proves the export cron's mail bridge end-to-end (C6).
      createUserDataRightsFeature({ appExportDownloadUrl: EXPORT_DOWNLOAD_URL }),
    ],
  });
  await createEventsTable(stack.db);
  await unsafePushTables(stack.db, { configValuesTable });
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
  await insertOne(stack.db, userTable, {
    id: USER_ID,
    tenantId: TENANT,
    email: "export-cron@example.test",
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
  clearInbox(TENANT);
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

describe("run-export-jobs cron-context", () => {
  test("Cron-Job-Kontext (configResolver, KEIN config) → Export läuft durch, bytesWritten > 0", async () => {
    const jobId = await seedPendingJob();
    const job = stack.registry.getJob(JOB_QN);
    expect(job).toBeDefined();

    // EXAKT der prod-Job-Kontext: configResolver gesetzt, config undefined.
    const jobCtx = {
      db: stack.db,
      registry: stack.registry,
      configResolver,
      _userId: SYSTEM_USER_ID,
      now: getTemporal().Now.instant(),
    };
    // Vor dem Fix wirft der Wrapper hier "ctx.config is missing".
    await job?.handler({}, jobCtx as never);

    const [row] = (await selectMany(stack.db, exportJobsTable, { id: jobId })) as Array<{
      status: string;
      bytesWritten: number | null;
      errorMessage: string | null;
    }>;
    expect(row?.errorMessage).toBeNull();
    expect(row?.status).toBe(EXPORT_JOB_STATUS.Done);
    expect(row?.bytesWritten ?? 0).toBeGreaterThan(0);

    // C6 — der echte Export-Cron versendet die Default-Export-ready-Mail ueber
    // den aus configResolver gebauten inmemory-Transport (kein App-Callback).
    // user.locale="de" → deutsches Subject; downloadUrl traegt den Magic-Link.
    const inbox = getInbox(TENANT);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.to).toBe("export-cron@example.test");
    expect(inbox[0]?.subject).toContain("Dein Datenexport ist bereit");
    expect(inbox[0]?.html).toContain(EXPORT_DOWNLOAD_URL);
  });
});
