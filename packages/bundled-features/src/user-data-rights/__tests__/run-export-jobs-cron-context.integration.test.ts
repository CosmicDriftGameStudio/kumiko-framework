// Runs the real registered export cron job (r.job "run-export-jobs")
// through the job context, as the production job runner invokes it:
// `ctx.services.configResolver` is set (with the app override provider=inmemory), but
// there is no per-request `ctx.config` (the HTTP dispatcher creates that).
//
// The existing run-export-jobs test passed `buildStorageProvider` manually,
// bypassing this path: the wrapper builds providerCtx from the job context.
// Without the configResolver→ConfigAccessor conversion,
// createFileProviderForTenant throws "ctx.config is missing", causing every
// export to become "failed".

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";

import { createTenantDb, selectMany } from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser, type JobContext } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { registerMailTranslations } from "@cosmicdrift/kumiko-framework/i18n";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { localeDeBundle } from "@cosmicdrift/kumiko-locale-de";
import {
  resetTestTables,
  runInSystemRowLevelSecurityScope,
  seedRowViaEventStore,
} from "@cosmicdrift/kumiko-testing/helpers";
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
import { createChannelEmailFeature } from "../../channel-email/feature.ts";
import { createInMemoryTransport } from "../../channel-email/types.ts";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/index.ts";
import {
  configValuesTable,
  createConfigFeature,
  createConfigResolver,
} from "../../config/index.ts";
import { createDataRetentionFeature } from "../../data-retention/index.ts";
import { createDeliveryFeature, createDeliveryTestContext } from "../../delivery/index.ts";
import { deliveryAttemptsTable, notificationPreferencesTable } from "../../delivery/tables.ts";
import { createFileFoundationFeature } from "../../file-foundation/index.ts";
import { createFileProviderInMemoryFeature } from "../../file-provider-inmemory/index.ts";
import { createSessionsFeature } from "../../sessions/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantMembershipEntity, tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { createUserFeature, USER_STATUS, userEntity, userTable } from "../../user/index.ts";
import { createUserDataRightsFeature } from "../feature.ts";
import { exportDownloadTokenEntity } from "../schema/download-token.ts";
import { EXPORT_JOB_STATUS, exportJobEntity, exportJobsTable } from "../schema/export-job.ts";
import { UserDataRightsJobs } from "../web/constants.ts";

const TENANT = "00000000-0000-4000-8000-0000000009a1";
const USER_ID = "00000000-0000-4000-8000-0000000009b1";
const JOB_QN = UserDataRightsJobs.runExportJobs;

// App-wide override like money-horse's cashColtConfigResolver: provider=inmemory
// without a per-tenant config row. The job context carries this resolver, not
// config.
const configResolver = createConfigResolver({
  appOverrides: new Map([["file-foundation:config:provider", "inmemory"]]),
});

const EXPORT_DOWNLOAD_URL = "https://app.test/user-export/by-token";

const emailTransport = createInMemoryTransport();
const RECIPIENT_EMAIL = "export-cron@example.test";

let stack: TestStack;
let notifyFactory: unknown;
let lastFixtureEventId = 0n;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createUserFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createFileFoundationFeature(),
      createFileProviderInMemoryFeature(),
      ...authMailRendererFeatures(),
      createDeliveryFeature(),
      createChannelEmailFeature({
        transport: emailTransport,
        resolveEmail: async () => RECIPIENT_EMAIL,
      }),
      createAuthFoundationFeature(),
      createSessionsFeature(),
      // appExportDownloadUrl set → the default export-ready mail is enabled, so
      // this also proves the export cron's mail bridge end-to-end.
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
  await unsafeCreateEntityTable(stack.db, tenantMembershipEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [
    exportJobsTable,
    userTable,
    tenantMembershipsTable,
    eventsTable,
  ]);
  await seedRowViaEventStore(stack.db, userTable, {
    id: USER_ID,
    email: RECIPIENT_EMAIL,
    passwordHash: "hashed",
    displayName: "Cron Export",
    locale: "de",
    emailVerified: true,
    roles: '["Member"]',
    status: USER_STATUS.Active,
  });
  await seedRowViaEventStore(stack.db, tenantMembershipsTable, {
    tenantId: TENANT,
    userId: USER_ID,
    roles: '["Member"]',
  });
  emailTransport.sent.length = 0;
  lastFixtureEventId = await maxEventId();
});

// Seeds a pending export job through the real request-export handler.
async function seedPendingJob(): Promise<string> {
  const res = await stack.http.writeOk<{ jobId: string }>(
    "user-data-rights:write:request-export",
    {},
    { id: USER_ID, tenantId: TENANT, roles: ["Member"] },
  );
  return res.jobId;
}

registerMailTranslations("de", localeDeBundle);

async function maxEventId(): Promise<bigint> {
  const events = await selectMany<{ id: bigint | string }>(stack.db, eventsTable, {});
  return events.reduce((max, event) => (BigInt(event.id) > max ? BigInt(event.id) : max), 0n);
}

// Serialized rows of the stores a mail send could leak into: the event store
// and the delivery attempt log (no job row is written on the immediate path).
// Events up to the fixture checkpoint are the seeds, which carry the address as user data.
async function persistedDeliveryTraces(): Promise<string> {
  const events = await selectMany<{ id: bigint | string }>(stack.db, eventsTable, {});
  const rows = [
    ...events.filter((event) => BigInt(event.id) > lastFixtureEventId),
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

    // Exact production job context: configResolver is set, while config is undefined.
    const jobCtx = {
      db: createTenantDb({
        db: stack.db,
        tenantId: TENANT,
        mode: "tenant",
        grants: {
          unsafeRaw: { reason: "processes pending export jobs across every tenant" },
        },
      }),
      registry: stack.registry,
      services: { configResolver, _notifyFactory: notifyFactory, extensions: {} },
      lifecycle: {},
      systemUser: createSystemUser(TENANT),
      obs: { log: { warn() {} } },
      now: getTemporal().Now.instant(),
    };
    // Before the fix, the wrapper throws "ctx.config is missing".
    // jobCtx deliberately replicates the minimal production context (without
    // triggeredBy); double-cast at this test boundary because the handler
    // under test never accesses those fields.
    // The job runs outside a dispatch here, so the mail delivery has no ambient scope of its own.
    await runInSystemRowLevelSecurityScope("test runs the export job outside the job runner", () =>
      job?.handler({}, jobCtx as unknown as JobContext),
    );

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
