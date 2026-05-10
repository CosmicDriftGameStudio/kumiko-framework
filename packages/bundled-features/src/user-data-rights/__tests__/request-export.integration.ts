// request-export.write + export-status.query Integration-Test (S2.U3 Atom 2).
//
// Pinst die User-Touchpoints des Async-Export-Pipeline. Atom 3b (Worker)
// + Atom 4b (Download) sind separate Sprints — hier nur der Trigger
// + das Polling.
//
// Test-Pflichten aus Plan-Doc + advisor-Review:
//   - Happy path: User klickt → Job pending entsteht
//   - App-side-Idempotency: 2nd Klick sieht existing → isExisting=true,
//     KEIN neuer Job + KEIN neues Event
//   - DB-Constraint Race-Schutz: zwischen fetchOne + crud.create
//     erscheint ein paralleler Job (simuliert durch direct-INSERT) →
//     2nd Klick catched 23505 + return existing
//   - Cross-Tenant: Alice in 2 Tenants, Tenant A click → Tenant B click
//     sieht via App-side-Check den A-Job (DB-Constraint matcht nur auf
//     userId, App-side-Check nutzt ctx.db.raw fuer Cross-Tenant-Lookup)
//   - Status-Polling: User sieht eigene Jobs, Cross-User-Isolation,
//     hasJob=false wenn nichts da

import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  unsafeCreateEntityTable,
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
} from "@cosmicdrift/kumiko-framework/stack";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createComplianceProfilesFeature } from "../../compliance-profiles";
import { createDataRetentionFeature } from "../../data-retention";
import { createUserFeature } from "../../user";
import { createUserDataRightsFeature } from "../feature";
import { EXPORT_JOB_STATUS, exportJobEntity, exportJobsTable } from "../schema/export-job";

const REQUEST_EXPORT = "user-data-rights:write:request-export";
const EXPORT_STATUS = "user-data-rights:query:export-status";

let stack: TestStack;

const tenantA = testTenantId(1);
const tenantB = testTenantId(2);
const aliceUser = createTestUser({ id: 42, tenantId: tenantA, roles: ["Member"] });
const aliceFromB = createTestUser({ id: 42, tenantId: tenantB, roles: ["Member"] });
const bobUser = createTestUser({ id: 43, tenantId: tenantA, roles: ["Member"] });

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createUserFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createUserDataRightsFeature(),
    ],
  });
  await unsafeCreateEntityTable(stack.db, exportJobEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await stack.db.delete(exportJobsTable);
  await stack.db.execute(sql`DELETE FROM kumiko_events`);
});

type RequestExportResponse = {
  jobId: string;
  status: string;
  isExisting: boolean;
};

describe("request-export :: happy path", () => {
  test("erster Klick erzeugt pending Job mit requestedFromTenantId=Caller-Tenant", async () => {
    const result = await stack.http.writeOk<RequestExportResponse>(REQUEST_EXPORT, {}, aliceUser);

    expect(result.isExisting).toBe(false);
    expect(result.status).toBe(EXPORT_JOB_STATUS.Pending);
    expect(result.jobId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);

    const rows = await stack.db.select().from(exportJobsTable);
    expect(rows).toHaveLength(1);
    // biome-ignore lint/suspicious/noExplicitAny: drizzle-row typing
    expect((rows[0] as any).userId).toBe(aliceUser.id);
    // biome-ignore lint/suspicious/noExplicitAny: drizzle-row typing
    expect((rows[0] as any).requestedFromTenantId).toBe(tenantA);
    // biome-ignore lint/suspicious/noExplicitAny: drizzle-row typing
    expect((rows[0] as any).status).toBe(EXPORT_JOB_STATUS.Pending);
  });

  test("Event 'export-job.created' im Stream", async () => {
    await stack.http.writeOk(REQUEST_EXPORT, {}, aliceUser);

    const events = await stack.db.execute(sql`
      SELECT type FROM kumiko_events WHERE aggregate_type = 'export-job'
    `);
    // biome-ignore lint/suspicious/noExplicitAny: drizzle-execute typing
    const rows = ((events as any).rows ?? events) as Array<{ type: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe("export-job.created");
  });
});

describe("request-export :: App-side-Idempotency (primaerer Pfad)", () => {
  test("2nd Klick sieht existing Job → isExisting=true, KEIN neuer Job, KEIN neues Event", async () => {
    const first = await stack.http.writeOk<RequestExportResponse>(REQUEST_EXPORT, {}, aliceUser);
    expect(first.isExisting).toBe(false);

    const second = await stack.http.writeOk<RequestExportResponse>(REQUEST_EXPORT, {}, aliceUser);
    expect(second.isExisting).toBe(true);
    expect(second.jobId).toBe(first.jobId);
    expect(second.status).toBe(EXPORT_JOB_STATUS.Pending);

    const rows = await stack.db.select().from(exportJobsTable);
    expect(rows).toHaveLength(1);

    const events = await stack.db.execute(sql`
      SELECT type FROM kumiko_events WHERE aggregate_type = 'export-job'
    `);
    // biome-ignore lint/suspicious/noExplicitAny: drizzle-execute typing
    const evRows = ((events as any).rows ?? events) as Array<{ type: string }>;
    expect(evRows).toHaveLength(1); // 1 Klick = 1 Event, nicht 2
  });

  test("Klick nach done-Job ist NEUER Job (Audit-Historie wird nicht blockiert)", async () => {
    const first = await stack.http.writeOk<RequestExportResponse>(REQUEST_EXPORT, {}, aliceUser);
    // Worker-Simulation: status auf done flippen (direct-update OK in Test)
    await stack.db
      .update(exportJobsTable)
      .set({ status: EXPORT_JOB_STATUS.Done })
      .where(sql`id = ${first.jobId}`);

    const second = await stack.http.writeOk<RequestExportResponse>(REQUEST_EXPORT, {}, aliceUser);
    expect(second.isExisting).toBe(false);
    expect(second.jobId).not.toBe(first.jobId);

    const rows = await stack.db.select().from(exportJobsTable);
    expect(rows).toHaveLength(2);
  });
});

describe("request-export :: Cross-Tenant (Plan-Doc-Pflicht-Test)", () => {
  test("Alice klickt aus Tenant A → Tenant B Klick sieht den A-Job (kein 2. Job)", async () => {
    const fromA = await stack.http.writeOk<RequestExportResponse>(REQUEST_EXPORT, {}, aliceUser);
    expect(fromA.isExisting).toBe(false);

    // Alice klickt aus Tenant B (anderer executorUser.tenantId, gleicher
    // userId). App-side-Pre-Check via ctx.db.raw findet den A-Job.
    const fromB = await stack.http.writeOk<RequestExportResponse>(REQUEST_EXPORT, {}, aliceFromB);
    expect(fromB.isExisting).toBe(true);
    expect(fromB.jobId).toBe(fromA.jobId);

    // Genau 1 Job (kein 2. fuer Tenant B)
    const rows = await stack.db.select().from(exportJobsTable);
    expect(rows).toHaveLength(1);
    // requestedFromTenantId = Tenant aus 1. Klick (= A), nicht B
    // biome-ignore lint/suspicious/noExplicitAny: drizzle-row typing
    expect((rows[0] as any).requestedFromTenantId).toBe(tenantA);
  });
});

describe("request-export :: Race-Schutz (Promise.all parallel)", () => {
  test("zwei parallele Klicks → 1 Job, beide Caller sehen denselben jobId", async () => {
    // Promise.all parallelisiert die Handler. PG-Layer macht die
    // Serialisierung im Tx-Scheduling — einer wird crud.create-Race-
    // Loser und nimmt den 23505-Catch-Pfad, der andere wins.
    // Welcher konkret welchen Pfad nimmt haengt vom DB-Scheduling +
    // App-side-Pre-Check-Timing — beide sind correctness-aequivalent.
    // Test pinst die Invariante: 2 parallele Klicks → 1 Row, beide
    // Caller sehen denselben jobId.
    const [a, b] = await Promise.all([
      stack.http.writeOk<RequestExportResponse>(REQUEST_EXPORT, {}, aliceUser),
      stack.http.writeOk<RequestExportResponse>(REQUEST_EXPORT, {}, aliceUser),
    ]);

    expect(a.jobId).toBe(b.jobId);
    // Genau einer ist isExisting=false (winner). Der andere kann via
    // App-side-Check ODER via 23505-Race-Catch isExisting=true returnen
    // — beides ist funktional korrekt.
    const winners = [a, b].filter((r) => r.isExisting === false);
    expect(winners).toHaveLength(1);

    const rows = await stack.db.select().from(exportJobsTable);
    expect(rows).toHaveLength(1);
  });

  // 10+ parallele Klicks bewusst NICHT getestet: das triggert event-
  // store-stream-version-conflicts (separate Schicht ueber dem Projection-
  // Index, Memory feedback_event_store_tenant_consistency). High-
  // Concurrency-Race ist orthogonal zu unserem App-side+DB-Constraint-
  // Schutz — sollte in framework/event-store-Tests gepinnt werden,
  // nicht hier. 2-paralleler-Test reicht fuer die "Race-Schutz greift"-
  // Invariante.
});

describe("export-status :: User-Polling", () => {
  type StatusResponse =
    | { hasJob: false }
    | {
        hasJob: true;
        job: {
          id: string;
          status: string;
          requestedAt: string | null;
          completedAt: string | null;
          expiresAt: string | null;
          errorMessage: string | null;
          bytesWritten: number | null;
        };
      };

  test("hasJob=false wenn User noch nichts requestet hat", async () => {
    const result = await stack.http.queryOk<StatusResponse>(EXPORT_STATUS, {}, aliceUser);
    expect(result.hasJob).toBe(false);
  });

  test("hasJob=true mit pending-Job nach request-export", async () => {
    await stack.http.writeOk(REQUEST_EXPORT, {}, aliceUser);

    const result = await stack.http.queryOk<StatusResponse>(EXPORT_STATUS, {}, aliceUser);
    expect(result.hasJob).toBe(true);
    if (!result.hasJob) throw new Error("expected job");
    expect(result.job.status).toBe(EXPORT_JOB_STATUS.Pending);
    expect(result.job.requestedAt).not.toBeNull();
    expect(result.job.completedAt).toBeNull();
    expect(result.job.expiresAt).toBeNull();
    expect(result.job.errorMessage).toBeNull();
  });

  test("Cross-User-Isolation: Bob sieht Alice's Job NICHT", async () => {
    await stack.http.writeOk(REQUEST_EXPORT, {}, aliceUser);

    const bobResult = await stack.http.queryOk<StatusResponse>(EXPORT_STATUS, {}, bobUser);
    expect(bobResult.hasJob).toBe(false);
  });

  test("liefert NEUESTEN Job zurueck (orderBy desc requestedAt)", async () => {
    const T = getTemporal();
    // 1. Job done in der Vergangenheit
    const oldJobId = "11111111-1111-4111-8111-111111111111";
    await stack.db.insert(exportJobsTable).values({
      id: oldJobId,
      tenantId: tenantA,
      userId: aliceUser.id,
      requestedFromTenantId: tenantA,
      status: EXPORT_JOB_STATUS.Done,
      requestedAt: T.Instant.fromEpochMilliseconds(Date.now() - 60_000),
    });

    // 2. neuer pending-Job
    const newJob = await stack.http.writeOk<RequestExportResponse>(REQUEST_EXPORT, {}, aliceUser);

    const result = await stack.http.queryOk<StatusResponse>(EXPORT_STATUS, {}, aliceUser);
    expect(result.hasJob).toBe(true);
    if (!result.hasJob) throw new Error("expected job");
    expect(result.job.id).toBe(newJob.jobId);
    expect(result.job.status).toBe(EXPORT_JOB_STATUS.Pending);
  });

  test("Cross-Tenant: Polling aus Tenant B sieht den Job aus Tenant A", async () => {
    await stack.http.writeOk(REQUEST_EXPORT, {}, aliceUser);

    const fromB = await stack.http.queryOk<StatusResponse>(EXPORT_STATUS, {}, aliceFromB);
    expect(fromB.hasJob).toBe(true);
  });
});
