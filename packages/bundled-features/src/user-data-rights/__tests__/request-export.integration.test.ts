// Integration test for the request-export.write and export-status.query user flows.
//
// Covers the async export pipeline's user touchpoints: triggering a request
// and polling its status. Worker processing and download are tested separately.
//
// Required behaviours:
//   - Happy path: a user click creates a pending job
//   - App-side idempotency: a second click finds the existing job and returns
//     isExisting=true without creating a new job or event
//   - DB-constraint race protection: if a concurrent job appears between
//     fetchOne and crud.create (simulated by direct-INSERT), the second click
//     catches 23505 and returns the existing job
//   - Cross-tenant access: Alice in two tenants sees the Tenant A job after
//     clicking from Tenant B (the DB constraint matches only userId, while
//     the app-side check uses ctx.db.raw for the cross-tenant lookup)
//   - Status polling: users see their own jobs, with cross-user isolation and
//     hasJob=false when no job exists

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { asRawClient, selectMany } from "@cosmicdrift/kumiko-framework/db";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { resetTestTables, seedRowViaEventStore } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.ts";
import { createDataRetentionFeature } from "../../data-retention/index.ts";
import { createSessionsFeature } from "../../sessions/index.ts";
import { createUserFeature } from "../../user/index.ts";
import { createUserDataRightsFeature } from "../feature.ts";
import { EXPORT_JOB_STATUS, exportJobEntity, exportJobsTable } from "../schema/export-job.ts";
import { changeExportJob } from "./export-job-writes.ts";

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
      createAuthFoundationFeature(),
      createSessionsFeature(),
      createUserDataRightsFeature(),
    ],
  });
  await unsafeCreateEntityTable(stack.db, exportJobEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [exportJobsTable, eventsTable]);
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

    const rows = await selectMany(stack.db, exportJobsTable);
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

    const events = await asRawClient(stack.db).unsafe(`
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

    const rows = await selectMany(stack.db, exportJobsTable);
    expect(rows).toHaveLength(1);

    const events = await asRawClient(stack.db).unsafe(`
      SELECT type FROM kumiko_events WHERE aggregate_type = 'export-job'
    `);
    // biome-ignore lint/suspicious/noExplicitAny: drizzle-execute typing
    const evRows = ((events as any).rows ?? events) as Array<{ type: string }>;
    expect(evRows).toHaveLength(1); // 1 click = 1 event, not 2
  });

  test("Klick nach done-Job ist NEUER Job (Audit-Historie wird nicht blockiert)", async () => {
    const first = await stack.http.writeOk<RequestExportResponse>(REQUEST_EXPORT, {}, aliceUser);
    // Simulate the worker by setting status to done; a direct update is acceptable in this test.
    await changeExportJob(stack.db, first.jobId, { status: EXPORT_JOB_STATUS.Done }, tenantA);

    const second = await stack.http.writeOk<RequestExportResponse>(REQUEST_EXPORT, {}, aliceUser);
    expect(second.isExisting).toBe(false);
    expect(second.jobId).not.toBe(first.jobId);

    const rows = await selectMany(stack.db, exportJobsTable);
    expect(rows).toHaveLength(2);
  });
});

describe("request-export :: Cross-Tenant (Plan-Doc-Pflicht-Test)", () => {
  test("Alice klickt aus Tenant A → Tenant B Klick sieht den A-Job (kein 2. Job)", async () => {
    const fromA = await stack.http.writeOk<RequestExportResponse>(REQUEST_EXPORT, {}, aliceUser);
    expect(fromA.isExisting).toBe(false);

    // Alice clicks from Tenant B (a different executorUser.tenantId with the same
    // userId). The app-side pre-check via ctx.db.raw finds the Tenant A job.
    const fromB = await stack.http.writeOk<RequestExportResponse>(REQUEST_EXPORT, {}, aliceFromB);
    expect(fromB.isExisting).toBe(true);
    expect(fromB.jobId).toBe(fromA.jobId);

    // Ensures that Tenant B does not receive a second job.
    const rows = await selectMany(stack.db, exportJobsTable);
    expect(rows).toHaveLength(1);
    // requestedFromTenantId remains the tenant of the first click (= A), not B.
    // biome-ignore lint/suspicious/noExplicitAny: drizzle-row typing
    expect((rows[0] as any).requestedFromTenantId).toBe(tenantA);
  });
});

describe("request-export :: Race-Schutz (Promise.all parallel)", () => {
  test("zwei parallele Klicks → 1 Job, beide Caller sehen denselben jobId", async () => {
    // Promise.all runs the handlers in parallel. The PG layer serializes them
    // through transaction scheduling: one loses the crud.create race and
    // takes the 23505 catch path, while the other wins.
    // Which handler takes which path depends on DB scheduling and app-side
    // pre-check timing; both outcomes are equivalent for correctness.
    // The invariant is that two parallel clicks produce one row and both
    // callers receive the same jobId.
    const [a, b] = await Promise.all([
      stack.http.writeOk<RequestExportResponse>(REQUEST_EXPORT, {}, aliceUser),
      stack.http.writeOk<RequestExportResponse>(REQUEST_EXPORT, {}, aliceUser),
    ]);

    expect(a.jobId).toBe(b.jobId);
    // Exactly one response has isExisting=false (the winner). The other may
    // return isExisting=true through either the app-side check or the 23505
    // race catch; both outcomes are functionally correct.
    const winners = [a, b].filter((r) => r.isExisting === false);
    expect(winners).toHaveLength(1);

    const rows = await selectMany(stack.db, exportJobsTable);
    expect(rows).toHaveLength(1);
  });

  // 10+ parallel clicks are deliberately not tested: they trigger event-store
  // stream version conflicts, a separate layer above the projection index.
  // High-concurrency races are orthogonal to this app-side plus DB-constraint
  // protection and belong in the framework's event-store tests. Two parallel
  // clicks are enough to pin the race-protection invariant.
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
    const oldJobId = "11111111-1111-4111-8111-111111111111";
    await seedRowViaEventStore(stack.db, exportJobsTable, {
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
