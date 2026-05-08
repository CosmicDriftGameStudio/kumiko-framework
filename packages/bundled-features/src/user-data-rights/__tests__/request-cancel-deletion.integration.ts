// Forget-Pfad mit Grace — request-deletion + cancel-deletion (S2.U5a).
//
// Pinst die Endpoint-Semantik vor dem Cleanup-Runner (S2.U5b):
//   - Active → DeletionRequested + gracePeriodEnd = now + profile.graceDays
//   - DeletionRequested → Active (nur innerhalb Grace) + gracePeriodEnd = NULL
//   - Idempotenz / falsche State-Transitions / Grace-Period-Expiry
//   - Compliance-Profile-Resolution wirklich greift (eu-dsgvo = 30 Tage)
//
// User-Explicit-Anforderung "exporte + fristen" — der Frist-Set-Pfad ist
// hier; der Frist-Ablauf-Cleanup folgt mit S2.U5b.

import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createEntityTable,
  createTestUser,
  setupTestStack,
  testTenantId,
  testUserId,
  type TestStack,
} from "@cosmicdrift/kumiko-framework/stack";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles";
import { createDataRetentionFeature } from "../../data-retention";
import { USER_STATUS, userEntity, userTable } from "../../user";
import { createUserFeature } from "../../user/feature";
import { createUserDataRightsFeature } from "../feature";

const REQUEST_DELETION = "user-data-rights:write:request-deletion";
const CANCEL_DELETION = "user-data-rights:write:cancel-deletion";
const SET_PROFILE = "compliance-profiles:write:set-profile";

let stack: TestStack;

const tenantA = testTenantId(1);
// Tenant-Admin fuer set-profile (Profile-Wahl ist privileged).
const tenantAdmin = createTestUser({
  id: 1,
  tenantId: tenantA,
  roles: ["TenantAdmin"],
});
// Normaler User der seinen eigenen Forget-Antrag stellt.
const aliceUser = createTestUser({
  id: 42,
  tenantId: tenantA,
  roles: ["Member"],
});

const features = [
  createUserFeature(),
  createDataRetentionFeature(),
  createComplianceProfilesFeature(),
  createUserDataRightsFeature(),
];

beforeAll(async () => {
  stack = await setupTestStack({ features });
  await createEntityTable(stack.db, userEntity);
  await createEntityTable(stack.db, tenantComplianceProfileEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  // Hard-clean User-Rows fuer einen sauberen Start je Test. softDelete
  // wuerde sonst row-state aus voherigen Tests einschleppen.
  await stack.db.delete(userTable);
  await stack.db.execute(sql`DELETE FROM read_tenant_compliance_profiles`);
  await stack.db.execute(sql`DELETE FROM kumiko_events`);
});

// gracePeriodEnd ist `instant()` (Temporal.Instant in JS). Nicht JS-Date —
// die customType-Codec wirft sonst beim Insert "time zone gmt+0200 not
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
  await stack.db.insert(userTable).values({
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
  const rows = (await stack.db
    .select({
      status: userTable["status"],
      gracePeriodEnd: userTable["gracePeriodEnd"],
    })
    .from(userTable)
    .where(eq(userTable["id"], aliceUser.id))
    .limit(1)) as Array<{ status: string; gracePeriodEnd: Instant | null }>;
  return rows[0] ?? null;
}

describe("POST request-deletion :: happy path", () => {
  test("Active-User → status=deletionRequested + gracePeriodEnd ~30 Tage (eu-dsgvo)", async () => {
    await seedAlice();
    // eu-dsgvo gibt gracePeriod={days:30} — Default-fallback minimal-no-region
    // hat ebenfalls 30 days, aber wir setzen explizit damit Eingang der
    // Profile-Resolution sichtbar ist.
    await stack.http.writeOk(SET_PROFILE, { profileKey: "eu-dsgvo" }, tenantAdmin);

    const result = await stack.http.writeOk<{
      userId: string;
      status: string;
      graceDays: number;
    }>(REQUEST_DELETION, {}, aliceUser);

    expect(result.status).toBe(USER_STATUS.DeletionRequested);
    expect(result.userId).toBe(aliceUser.id);
    expect(result.graceDays).toBe(30);

    const row = await fetchAlice();
    expect(row?.status).toBe(USER_STATUS.DeletionRequested);
    expect(row?.gracePeriodEnd).not.toBeNull();
    // Frist liegt zwischen +29d und +31d (Drift-Toleranz, weil now() server-side).
    const graceMs = row?.gracePeriodEnd
      ? row.gracePeriodEnd.epochMilliseconds - Date.now()
      : 0;
    expect(graceMs).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    expect(graceMs).toBeLessThan(31 * 24 * 60 * 60 * 1000);
  });

  test("ohne explizites Profile → minimal-no-region-Fallback (30 Tage)", async () => {
    await seedAlice();
    // Kein SET_PROFILE → resolveComplianceProfile fallt auf
    // minimal-no-region (warning="no-profile-selected") zurueck.
    const result = await stack.http.writeOk<{ graceDays: number }>(
      REQUEST_DELETION,
      {},
      aliceUser,
    );
    expect(result.graceDays).toBe(30);
  });
});

// UnprocessableError serialisiert als code="unprocessable" + details.reason
// = unsere konkrete Begruendung. Helper macht assert-Site lesbar.
function reason(err: { details?: unknown }): string | undefined {
  return (err.details as { reason?: string } | undefined)?.reason;
}

describe("POST request-deletion :: state-transitions", () => {
  test("User existiert nicht → 422 user_not_found", async () => {
    // Alice nicht gesseedet — der Handler liest die Row.
    const err = await stack.http.writeErr(REQUEST_DELETION, {}, aliceUser);
    expect(err.code).toBe("unprocessable");
    expect(err.httpStatus).toBe(422);
    expect(reason(err)).toBe("user_not_found");
  });

  test("schon im DeletionRequested-State → 422 user_not_in_active_state (idempotenz-guard)", async () => {
    await seedAlice({ status: USER_STATUS.DeletionRequested });
    const err = await stack.http.writeErr(REQUEST_DELETION, {}, aliceUser);
    expect(reason(err)).toBe("user_not_in_active_state");
    expect(
      (err.details as { currentStatus?: string })?.currentStatus,
    ).toBe(USER_STATUS.DeletionRequested);
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

describe("POST cancel-deletion :: happy path", () => {
  test("innerhalb Grace → status=Active + gracePeriodEnd=NULL", async () => {
    const futureGrace = instantFromOffsetMs(25 * 24 * 60 * 60 * 1000);
    await seedAlice({
      status: USER_STATUS.DeletionRequested,
      gracePeriodEnd: futureGrace,
    });

    const result = await stack.http.writeOk<{ userId: string; status: string }>(
      CANCEL_DELETION,
      {},
      aliceUser,
    );
    expect(result.status).toBe(USER_STATUS.Active);

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
    expect((err.details as { currentStatus?: string })?.currentStatus).toBe(
      USER_STATUS.Active,
    );
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
    // Bewusst nicht reversibel — Cleanup-Runner darf in der Zwischenzeit
    // schon angelaufen sein, Reversal waere data-loss-Risiko.
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
    await stack.db.insert(userTable).values({
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

    // Alice unverändert.
    const aliceRow = await fetchAlice();
    expect(aliceRow?.status).toBe(USER_STATUS.Active);
    expect(aliceRow?.gracePeriodEnd).toBeNull();
  });
});
