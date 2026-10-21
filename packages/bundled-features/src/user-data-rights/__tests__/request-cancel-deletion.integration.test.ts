// Grace-period semantics for request-deletion and cancel-deletion:
//   - Active → DeletionRequested + gracePeriodEnd = now + profile.graceDays
//   - DeletionRequested → Active only during the grace period + gracePeriodEnd = NULL
//   - Idempotency, invalid state transitions, and grace-period expiry
//   - The compliance profile determines the grace period (eu-dsgvo = 30 days)
//
// This covers setting the deadline; expiry cleanup is handled separately.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser, testTenantId, testUserId } from "@cosmicdrift/kumiko-framework/seeding";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { resetTestTables, seedRow } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../../compliance-profiles/index.ts";
import { createDataRetentionFeature } from "../../data-retention/index.ts";
import { createSessionsFeature } from "../../sessions/index.ts";
import { createUserFeature } from "../../user/feature.ts";
import { USER_STATUS, userEntity, userTable } from "../../user/index.ts";
import { createUserDataRightsFeature } from "../feature.ts";

const REQUEST_DELETION = "user-data-rights:write:request-deletion";
const CANCEL_DELETION = "user-data-rights:write:cancel-deletion";
const SET_PROFILE = "compliance-profiles:write:set-profile";

let stack: TestStack;

const tenantA = testTenantId(1);
// Tenant admin required because choosing a profile is privileged.
const tenantAdmin = createTestUser({
  id: 1,
  tenantId: tenantA,
  roles: ["TenantAdmin"],
});
// Regular user submitting a deletion request for their own account.
const aliceUser = createTestUser({
  id: 42,
  tenantId: tenantA,
  roles: ["Member"],
});

const features = [
  createUserFeature(),
  createDataRetentionFeature(),
  createComplianceProfilesFeature(),
  createAuthFoundationFeature(),
  createSessionsFeature(),
  createUserDataRightsFeature(),
];

beforeAll(async () => {
  stack = await setupTestStack({ features });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [userTable, tenantComplianceProfileTable, eventsTable]);
});

// gracePeriodEnd uses `instant()` (Temporal.Instant in JS), not a JS Date;
// otherwise the customType codec rejects the insert with "time zone gmt+0200 not
// recognized".
type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;

function instantFromOffsetMs(offsetMs: number): Instant {
  return getTemporal().Instant.fromEpochMilliseconds(Date.now() + offsetMs);
}

async function seedAlice(
  overrides: Partial<{
    status: string;
    gracePeriodEnd: Instant | null;
  }> = {},
): Promise<void> {
  await seedRow(stack.db, userTable, {
    id: aliceUser.id,
    tenantId: tenantA,
    email: "alice@example.com",
    passwordHash: "hashed",
    displayName: "Alice",
    locale: "de",
    emailVerified: true,
    roles: '["Member"]',
    status: overrides.status ?? USER_STATUS.Active,
    gracePeriodEnd: overrides.gracePeriodEnd ?? null,
  });
}

async function fetchAlice(): Promise<{
  status: string;
  gracePeriodEnd: Instant | null;
} | null> {
  const rows = (await selectMany(stack.db, userTable, { id: aliceUser.id })) as Array<{
    status: string;
    gracePeriodEnd: Instant | null;
  }>;
  return rows[0] ?? null;
}

type RequestDeletionResponse = {
  userId: string;
  status: string;
  // ISO-8601 timestamp (Temporal.Instant.toString()) used as the absolute
  // cleanup trigger time compared with now() by the cleanup runner.
  gracePeriodEnd: string;
};

type CancelDeletionResponse = {
  userId: string;
  status: string;
  gracePeriodEnd: string | null;
};

describe("POST request-deletion :: happy path", () => {
  test("Active-User → status=deletionRequested + gracePeriodEnd ~30 Tage (eu-dsgvo)", async () => {
    await seedAlice();
    // eu-dsgvo sets gracePeriod={days:30}. The minimal-no-region default also
    // uses 30 days, but the explicit profile verifies that profile resolution ran.
    await stack.http.writeOk(SET_PROFILE, { profileKey: "eu-dsgvo" }, tenantAdmin);

    const result = await stack.http.writeOk<RequestDeletionResponse>(
      REQUEST_DELETION,
      {},
      aliceUser,
    );

    expect(result.status).toBe(USER_STATUS.DeletionRequested);
    expect(result.userId).toBe(aliceUser.id);

    // gracePeriodEnd lies between +29d and +31d (drift tolerance). This pins the
    // API contract (the response carries an ISO timestamp) and the database
    // state (fetchAlice's Instant) to the same deadline.
    const responseGraceMs = new Date(result.gracePeriodEnd).getTime() - Date.now();
    expect(responseGraceMs).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    expect(responseGraceMs).toBeLessThan(31 * 24 * 60 * 60 * 1000);

    const row = await fetchAlice();
    expect(row?.status).toBe(USER_STATUS.DeletionRequested);
    expect(row?.gracePeriodEnd).not.toBeNull();
    // DB-Wert == Response-Wert: derselbe Cleanup-Trigger-Timestamp.
    expect(row?.gracePeriodEnd?.toString()).toBe(result.gracePeriodEnd);
  });

  test("ohne explizites Profile → minimal-no-region-Fallback (~30 Tage)", async () => {
    await seedAlice();
    // Without SET_PROFILE, resolveComplianceProfile falls back to
    // minimal-no-region with warning="no-profile-selected".
    const result = await stack.http.writeOk<RequestDeletionResponse>(
      REQUEST_DELETION,
      {},
      aliceUser,
    );
    const graceMs = new Date(result.gracePeriodEnd).getTime() - Date.now();
    expect(graceMs).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    expect(graceMs).toBeLessThan(31 * 24 * 60 * 60 * 1000);
  });

  // Verify that addDurationSpec handles both `{days}` and `{hours}` overrides
  // instead of silently falling back to 30 days when `days` is absent.
  test("Profile-Override {hours: 6} → ~6h Grace (kein 30d-Fallback)", async () => {
    await seedAlice();
    await stack.http.writeOk(
      SET_PROFILE,
      {
        profileKey: "eu-dsgvo",
        override: JSON.stringify({ userRights: { gracePeriod: { hours: 6 } } }),
      },
      tenantAdmin,
    );

    const result = await stack.http.writeOk<RequestDeletionResponse>(
      REQUEST_DELETION,
      {},
      aliceUser,
    );
    // Tolerance window: +5h to +7h; the previous silent fallback was about 720h.
    const graceMs = new Date(result.gracePeriodEnd).getTime() - Date.now();
    expect(graceMs).toBeGreaterThan(5 * 60 * 60 * 1000);
    expect(graceMs).toBeLessThan(7 * 60 * 60 * 1000);
  });
});

// UnprocessableError serialisiert als code="unprocessable" + details.reason
// = unsere konkrete Begruendung. Helper macht assert-Site lesbar.
function reason(err: { details?: unknown }): string | undefined {
  return (err.details as { reason?: string } | undefined)?.reason;
}

describe("POST request-deletion :: state-transitions", () => {
  test("User existiert nicht → 422 user_not_found", async () => {
    // The user is not seeded, so the handler cannot find its row.
    const err = await stack.http.writeErr(REQUEST_DELETION, {}, aliceUser);
    expect(err.code).toBe("unprocessable");
    expect(err.httpStatus).toBe(422);
    expect(reason(err)).toBe("user_not_found");
  });

  test("schon im DeletionRequested-State → 422 user_not_in_active_state (idempotenz-guard)", async () => {
    await seedAlice({ status: USER_STATUS.DeletionRequested });
    const err = await stack.http.writeErr(REQUEST_DELETION, {}, aliceUser);
    expect(reason(err)).toBe("user_not_in_active_state");
    expect((err.details as { currentStatus?: string })?.currentStatus).toBe(
      USER_STATUS.DeletionRequested,
    );
  });

  test("im Restricted-State (Art. 18) → 422 user_not_in_active_state", async () => {
    await seedAlice({ status: USER_STATUS.Restricted });
    const err = await stack.http.writeErr(REQUEST_DELETION, {}, aliceUser);
    expect(reason(err)).toBe("user_not_in_active_state");
  });

  test("schon Deleted → 422 user_not_in_active_state", async () => {
    await seedAlice({ status: USER_STATUS.Deleted });
    const err = await stack.http.writeErr(REQUEST_DELETION, {}, aliceUser);
    expect(reason(err)).toBe("user_not_in_active_state");
  });
});

describe("POST request-deletion :: concurrent requests", () => {
  test("parallel requests: one wins, every loser reports the status the winner wrote, never Active", async () => {
    await seedAlice();

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => stack.http.write(REQUEST_DELETION, {}, aliceUser)),
    );
    const bodies = await Promise.all(
      responses.map(
        (res) =>
          res.json() as Promise<{
            isSuccess?: boolean;
            error?: { details?: { reason?: string; currentStatus?: string } };
          }>,
      ),
    );

    const losers = bodies.filter((body) => body.isSuccess !== true);
    expect(bodies.filter((body) => body.isSuccess === true)).toHaveLength(1);
    expect(losers).toHaveLength(4);
    for (const loser of losers) {
      expect(loser.error?.details?.reason).toBe("user_not_in_active_state");
      expect(loser.error?.details?.currentStatus).toBe(USER_STATUS.DeletionRequested);
    }
  });
});

describe("POST cancel-deletion :: happy path", () => {
  test("innerhalb Grace → status=Active + gracePeriodEnd=NULL", async () => {
    const futureGrace = instantFromOffsetMs(25 * 24 * 60 * 60 * 1000);
    await seedAlice({
      status: USER_STATUS.DeletionRequested,
      gracePeriodEnd: futureGrace,
    });

    const result = await stack.http.writeOk<CancelDeletionResponse>(CANCEL_DELETION, {}, aliceUser);
    expect(result.status).toBe(USER_STATUS.Active);
    expect(result.gracePeriodEnd).toBeNull();

    const row = await fetchAlice();
    expect(row?.status).toBe(USER_STATUS.Active);
    expect(row?.gracePeriodEnd).toBeNull();
  });

  test("request → cancel Roundtrip ist clean (state komplett zurueck auf Active+NULL)", async () => {
    await seedAlice();
    await stack.http.writeOk(REQUEST_DELETION, {}, aliceUser);

    const requestedRow = await fetchAlice();
    expect(requestedRow?.status).toBe(USER_STATUS.DeletionRequested);
    expect(requestedRow?.gracePeriodEnd).not.toBeNull();

    await stack.http.writeOk(CANCEL_DELETION, {}, aliceUser);
    const cancelledRow = await fetchAlice();
    expect(cancelledRow?.status).toBe(USER_STATUS.Active);
    expect(cancelledRow?.gracePeriodEnd).toBeNull();
  });
});

describe("POST cancel-deletion :: state-transitions", () => {
  test("User existiert nicht → 422 user_not_found", async () => {
    const err = await stack.http.writeErr(CANCEL_DELETION, {}, aliceUser);
    expect(err.httpStatus).toBe(422);
    expect(reason(err)).toBe("user_not_found");
  });

  test("kein pending Forget (status=Active) → 422 no_pending_deletion", async () => {
    await seedAlice();
    const err = await stack.http.writeErr(CANCEL_DELETION, {}, aliceUser);
    expect(reason(err)).toBe("no_pending_deletion");
    expect((err.details as { currentStatus?: string })?.currentStatus).toBe(USER_STATUS.Active);
  });

  test("im Restricted-State (Art. 18) → 422 no_pending_deletion", async () => {
    await seedAlice({ status: USER_STATUS.Restricted });
    const err = await stack.http.writeErr(CANCEL_DELETION, {}, aliceUser);
    expect(reason(err)).toBe("no_pending_deletion");
  });

  test("Grace abgelaufen (gracePeriodEnd in Vergangenheit) → 422 grace_period_expired", async () => {
    const pastGrace = instantFromOffsetMs(-60 * 1000);
    await seedAlice({
      status: USER_STATUS.DeletionRequested,
      gracePeriodEnd: pastGrace,
    });
    const err = await stack.http.writeErr(CANCEL_DELETION, {}, aliceUser);
    expect(reason(err)).toBe("grace_period_expired");
    // Deliberately irreversible: the cleanup runner may already have started,
    // so reversal could risk data loss.
  });
});

describe("Cross-Tenant-Account-Semantik", () => {
  // The user entity is tenant-agnostic: `status` and `gracePeriodEnd` are
  // global user-row columns. A request in one tenant therefore marks the user as
  // deletionRequested for every tenant. This implements account-wide deletion
  // under GDPR Article 17; leaving a single tenant uses leave-tenant instead.
  test("request-deletion in Tenant A flippt User global (sichtbar fuer alle Memberships)", async () => {
    await seedAlice(); // Alice landet als 1 User-Row, status=Active.

    await stack.http.writeOk(REQUEST_DELETION, {}, aliceUser);

    // The same user row is visible from Tenant B, so its status is also
    // deletionRequested. There is no per-membership state; a second request from B
    // is rejected with "user_not_in_active_state", confirming the global scope.
    const aliceFromB = createTestUser({
      id: 42,
      tenantId: testTenantId(2),
      roles: ["Member"],
    });
    const err = await stack.http.writeErr(REQUEST_DELETION, {}, aliceFromB);
    expect(reason(err)).toBe("user_not_in_active_state");
    expect((err.details as { currentStatus?: string })?.currentStatus).toBe(
      USER_STATUS.DeletionRequested,
    );
  });
});

describe("Cross-User-Isolation", () => {
  test("Bobs request-deletion ueberschreibt nicht Alices state", async () => {
    await seedAlice();
    const bobUser = createTestUser({
      id: 43,
      tenantId: tenantA,
      roles: ["Member"],
    });
    await seedRow(stack.db, userTable, {
      id: testUserId(43),
      tenantId: tenantA,
      email: "bob@example.com",
      passwordHash: "hashed",
      displayName: "Bob",
      locale: "de",
      emailVerified: true,
      roles: '["Member"]',
      status: USER_STATUS.Active,
    });

    await stack.http.writeOk(REQUEST_DELETION, {}, bobUser);

    const aliceRow = await fetchAlice();
    expect(aliceRow?.status).toBe(USER_STATUS.Active);
    expect(aliceRow?.gracePeriodEnd).toBeNull();
  });
});
