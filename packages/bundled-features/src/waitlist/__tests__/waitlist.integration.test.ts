import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configureBlindIndexKey,
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
} from "@cosmicdrift/kumiko-framework/crypto";
import { createEventStoreExecutor, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { type TestStack, TestUsers } from "@cosmicdrift/kumiko-framework/stack";
import {
  resetBlindIndexKeyForTests,
  resetPiiSubjectKmsForTests,
  seedRow,
} from "@cosmicdrift/kumiko-framework/testing";
import { AuthHandlers } from "../../auth-email-password/index.js";
import { tenantInvitationsTable } from "../../tenant/index.js";
import { tenantMembershipsTable } from "../../tenant/membership-table.js";
import { tenantTable } from "../../tenant/schema/tenant.js";
import { USER_STATUS, userEntity, userTable } from "../../user/index.js";
import { seedUser } from "../../user/seeding.js";
import { runForgetCleanup } from "../../user-data-rights/run-forget-cleanup.js";
import { runUserExport } from "../../user-data-rights/run-user-export.js";
import { WAITLIST_FIELD_LIMITS, WaitlistHandlers, WaitlistQueries } from "../constants.js";
import { waitlistEntryTable } from "../entity.js";
import {
  acceptInviteAsNewUser,
  createWaitlistTestStack,
  INVITE_PASSWORD,
  loginCookies,
  mailsTo,
  resetWaitlistTestState,
  SYSTEM_ADMIN,
  tokenFromLastMailTo,
  userRowOf,
} from "./waitlist-test-stack.js";

let stack: TestStack;
const userExecutor = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });

async function requestUserDeletion(userId: string): Promise<void> {
  const row = await fetchOne(stack.db, userTable, { id: userId });
  if (!row) throw new Error("user missing");
  const result = await userExecutor.update(
    {
      id: userId,
      version: Number(row["version"]),
      changes: {
        status: USER_STATUS.DeletionRequested,
        gracePeriodEnd: Temporal.Now.instant().subtract({ minutes: 1 }),
      },
    },
    TestUsers.systemAdmin,
    createTenantDb(stack.db, SYSTEM_TENANT_ID, "system"),
  );
  expect(result.isSuccess).toBe(true);
}
let adminNoticeRecipient: string | null = null;

const TENANT_ADMIN: SessionUser = {
  id: crypto.randomUUID(),
  tenantId: crypto.randomUUID(),
  roles: ["TenantAdmin"],
};

beforeAll(async () => {
  stack = await createWaitlistTestStack({
    appName: "Acme",
    notifyRecipient: () => adminNoticeRecipient,
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  adminNoticeRecipient = null;
  await resetWaitlistTestState(stack);
});

let ipCounter = 0;
function submit(body: Record<string, unknown>, extraHeaders: Record<string, string> = {}) {
  ipCounter += 1;
  return stack.http.raw(
    "POST",
    "/api/write",
    { type: WaitlistHandlers.submit, payload: body },
    { "x-forwarded-for": `198.51.100.${ipCounter % 250}`, ...extraHeaders },
  );
}

const validBody = (email: string, extra: Record<string, unknown> = {}) => ({
  name: "Ada Lovelace",
  email,
  locale: "en",
  ...extra,
});

async function entries() {
  return selectMany(stack.db, waitlistEntryTable, {});
}

async function submitAndGetId(email: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await submit(validBody(email, extra));
  expect(res.status).toBe(200);
  const row = (await entries()).find((entry) => entry["email"] === email);
  if (!row) throw new Error("entry missing");
  return String(row["id"]);
}

describe("waitlist submit", () => {
  test("anonymous submit stores the entry and sends a confirmation mail", async () => {
    const res = await submit(validBody("ada@example.com", { company: "Analytical Engines" }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { isSuccess: boolean }).isSuccess).toBe(true);

    const rows = await entries();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["status"]).toBe("pending");
    expect(rows[0]?.["company"]).toBe("Analytical Engines");
    const confirmations = mailsTo("ada@example.com");
    expect(confirmations).toHaveLength(1);
    // Anyone can submit any address, so the mail must not carry submitted text.
    expect(confirmations[0]?.html).not.toContain("Ada Lovelace");
  });

  test("duplicate (different case) is answered identically without a second row or mail", async () => {
    const first = await submit(validBody("dup@example.com"));
    const firstBody = await first.json();
    const second = await submit(validBody("DUP@Example.com"));
    expect(second.status).toBe(first.status);
    expect(await second.json()).toEqual(firstBody);

    expect(await entries()).toHaveLength(1);
    expect(mailsTo("dup@example.com")).toHaveLength(1);
    expect(mailsTo("DUP@Example.com")).toHaveLength(0);
  });

  test("parallel submits for one email store a single entry and send one mail", async () => {
    const responses = await Promise.all(
      ["race@example.com", "Race@example.com", "RACE@example.com"].map((email) =>
        submit(validBody(email)),
      ),
    );
    expect(responses.map((res) => res.status)).toEqual([200, 200, 200]);
    expect(await entries()).toHaveLength(1);
    expect(mailsTo("race@example.com")).toHaveLength(1);
  });

  test("filled honeypot returns a fake success and stores nothing", async () => {
    const res = await submit(validBody("bot@example.com", { website: "http://spam.example" }));
    expect(res.status).toBe(200);
    expect(await entries()).toHaveLength(0);
    expect(mailsTo("bot@example.com")).toHaveLength(0);
  });

  test("invalid email and over-long name are rejected as field errors", async () => {
    const badEmail = await submit(validBody("not-an-email"));
    expect(badEmail.status).toBe(400);
    const longName = await submit(
      validBody("long@example.com", { name: "x".repeat(WAITLIST_FIELD_LIMITS.name + 1) }),
    );
    expect(longName.status).toBe(400);
    expect(await entries()).toHaveLength(0);
  });

  test("429 after the limit; rotating a spoofed left-most XFF entry does not escape the bucket", async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const res = await stack.http.raw(
        "POST",
        "/api/write",
        { type: WaitlistHandlers.submit, payload: validBody(`rl${attempt}@example.com`) },
        { "x-forwarded-for": `10.0.0.${attempt}, 203.0.113.50` },
      );
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
  });

  test("a fourth submit for one address (case variant) is 429 even from a fresh IP", async () => {
    const statuses: number[] = [];
    for (const email of [
      "Cap@example.com",
      "cap@example.com",
      "CAP@example.com",
      "cap@Example.com",
    ]) {
      statuses.push((await submit(validBody(email))).status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  test("admin notice goes to the notifyRecipient address, and is skipped for null", async () => {
    adminNoticeRecipient = "ops@example.com";
    await submit(validBody("notice1@example.com"));
    expect(mailsTo("ops@example.com")).toHaveLength(1);

    adminNoticeRecipient = null;
    await submit(validBody("notice2@example.com"));
    expect(mailsTo("ops@example.com")).toHaveLength(1);
    expect(await entries()).toHaveLength(2);
  });
});

describe("waitlist control characters", () => {
  test("CR/LF in name, company or portfolio is rejected with 400 and stores nothing", async () => {
    for (const field of ["name", "company", "portfolio"]) {
      const res = await submit(
        validBody("inject@example.com", { [field]: "Ada\r\nBcc: x@evil.test" }),
      );
      expect(res.status).toBe(400);
    }
    expect(await entries()).toHaveLength(0);
  });

  test("message keeps line breaks but rejects other control characters", async () => {
    const bad = await submit(validBody("ctl@example.com", { message: "a\u0000b" }));
    expect(bad.status).toBe(400);
    const ok = await submit(validBody("ctl@example.com", { message: "line1\r\nline2\tx" }));
    expect(ok.status).toBe(200);
  });
});

describe("waitlist admin access", () => {
  test("SystemAdmin lists, TenantAdmin gets 403, anonymous is rejected", async () => {
    await submitAndGetId("list@example.com");

    const ok = await stack.http.query(WaitlistQueries.list, {}, SYSTEM_ADMIN);
    expect(ok.status).toBe(200);

    const forbidden = await stack.http.query(WaitlistQueries.list, {}, TENANT_ADMIN);
    expect(forbidden.status).toBe(403);

    const anonymous = await stack.http.raw("POST", "/api/query", {
      type: WaitlistQueries.list,
      payload: {},
    });
    expect([401, 403]).toContain(anonymous.status);
  });

  test("TenantAdmin cannot invite or reject", async () => {
    const id = await submitAndGetId("nope@example.com");
    expect((await stack.http.write(WaitlistHandlers.invite, { id }, TENANT_ADMIN)).status).toBe(
      403,
    );
    expect((await stack.http.write(WaitlistHandlers.reject, { id }, TENANT_ADMIN)).status).toBe(
      403,
    );
  });
});

describe("waitlist invite and reject", () => {
  test("own-tenant invite creates the tenant once, invites, and grants no global role", async () => {
    const email = "invitee@example.com";
    const id = await submitAndGetId(email, { company: "Invitee GmbH" });

    const invited = await stack.http.writeOk<{ tenantId: string }>(
      WaitlistHandlers.invite,
      { id },
      SYSTEM_ADMIN,
    );
    const [tenant] = await selectMany(stack.db, tenantTable, { id: invited.tenantId });
    expect(tenant?.["name"]).toBe("Invitee GmbH");

    const [entry] = (await entries()).filter((row) => row["id"] === id);
    expect(entry?.["status"]).toBe("invited");
    expect(entry?.["linkedTenantId"]).toBe(invited.tenantId);
    expect(entry?.["invitedBy"]).toBe(SYSTEM_ADMIN.id);

    const firstToken = tokenFromLastMailTo(email);
    const reInvited = await stack.http.writeOk<{ tenantId: string }>(
      WaitlistHandlers.invite,
      { id },
      SYSTEM_ADMIN,
    );
    expect(reInvited.tenantId).toBe(invited.tenantId);
    expect(await selectMany(stack.db, tenantTable, {})).toHaveLength(1);
    const [invitation] = await selectMany(stack.db, tenantInvitationsTable, {});
    expect(invitation?.["status"]).toBe("pending");

    const secondToken = tokenFromLastMailTo(email);
    expect(secondToken).not.toBe(firstToken);
    const staleSignup = await stack.http.raw("POST", "/api/auth/invite-signup-complete", {
      token: firstToken,
      password: INVITE_PASSWORD,
    });
    expect(staleSignup.status).not.toBe(200);

    await acceptInviteAsNewUser(stack, email);
    await loginCookies(stack, email);
    expect((await userRowOf(stack, email)).globalRoles).toEqual([]);
  });

  test("reject marks the entry, then invite on it fails and a new submit is treated as new", async () => {
    const email = "rejected@example.com";
    const id = await submitAndGetId(email);
    await stack.http.writeOk(WaitlistHandlers.reject, { id }, SYSTEM_ADMIN);
    expect((await entries())[0]?.["status"]).toBe("rejected");

    const failure = await stack.http.writeErr(WaitlistHandlers.invite, { id }, SYSTEM_ADMIN);
    expect(failure.httpStatus).toBe(422);

    await submit(validBody(email));
    expect(await entries()).toHaveLength(2);
  });
});

describe("waitlist reject revokes the invitation", () => {
  test("invite then reject cancels the invitation and kills the mailed token", async () => {
    const email = "revoked@example.com";
    const id = await submitAndGetId(email);
    await stack.http.writeOk(WaitlistHandlers.invite, { id }, SYSTEM_ADMIN);
    const token = tokenFromLastMailTo(email);

    await stack.http.writeOk(WaitlistHandlers.reject, { id }, SYSTEM_ADMIN);

    const invitations = await selectMany(stack.db, tenantInvitationsTable, {});
    expect(invitations).toHaveLength(1);
    expect(invitations[0]?.["status"]).toBe("cancelled");
    const signup = await stack.http.raw("POST", "/api/auth/invite-signup-complete", {
      token,
      password: "Sup3r-secret-pw!",
    });
    expect(signup.status).not.toBe(200);
    expect(await selectMany(stack.db, userTable, {})).toHaveLength(0);
  });

  test("reject after the invitation was accepted answers 422", async () => {
    const email = "accepted@example.com";
    const id = await submitAndGetId(email);
    await stack.http.writeOk(WaitlistHandlers.invite, { id }, SYSTEM_ADMIN);
    await acceptInviteAsNewUser(stack, email);

    const failure = await stack.http.writeErr(WaitlistHandlers.reject, { id }, SYSTEM_ADMIN);
    expect(failure.httpStatus).toBe(422);
    const [entry] = (await entries()).filter((row) => row["id"] === id);
    expect(entry?.["status"]).toBe("invited");
  });
});

describe("waitlist submit while the rate-limit backend is down", () => {
  test("answers 503 rate_limit_unavailable and stores nothing", async () => {
    const outage = async () => {
      throw new Error("ECONNREFUSED redis");
    };
    const outageStack = await createWaitlistTestStack(
      { appName: "Acme" },
      { rateLimit: { enforce: outage, check: outage, peek: outage } },
    );
    try {
      const res = await outageStack.http.raw(
        "POST",
        "/api/write",
        { type: WaitlistHandlers.submit, payload: validBody("outage@example.com") },
        { "x-forwarded-for": "198.51.100.77" },
      );

      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("rate_limit_unavailable");
      expect(await selectMany(outageStack.db, waitlistEntryTable, {})).toHaveLength(0);
      expect(mailsTo("outage@example.com")).toHaveLength(0);
    } finally {
      await outageStack.cleanup();
    }
  });
});

describe("waitlist keeps an accepted invitation intact", () => {
  async function invitationStatuses(): Promise<unknown[]> {
    return (await selectMany(stack.db, tenantInvitationsTable, {})).map((row) => row["status"]);
  }

  async function inviteAndAccept(email: string): Promise<{ id: string; tenantId: string }> {
    const id = await submitAndGetId(email);
    const { tenantId } = await stack.http.writeOk<{ tenantId: string }>(
      WaitlistHandlers.invite,
      { id },
      SYSTEM_ADMIN,
    );
    await acceptInviteAsNewUser(stack, email);
    return { id, tenantId };
  }

  test("re-invite after accept answers 422 and leaves the invitation accepted", async () => {
    const { id } = await inviteAndAccept("reinvite-accepted@example.com");
    const mailsBefore = mailsTo("reinvite-accepted@example.com").length;

    const failure = await stack.http.writeErr(WaitlistHandlers.invite, { id }, SYSTEM_ADMIN);

    expect(failure.httpStatus).toBe(422);
    expect(failure.details).toMatchObject({ reason: "waitlist_not_invitable" });
    expect(await invitationStatuses()).toEqual(["accepted"]);
    expect(mailsTo("reinvite-accepted@example.com")).toHaveLength(mailsBefore);
  });

  test("re-invite then reject after accept stays 422 and the entry stays invited", async () => {
    const { id } = await inviteAndAccept("reinvite-reject@example.com");
    await stack.http.writeErr(WaitlistHandlers.invite, { id }, SYSTEM_ADMIN);

    const failure = await stack.http.writeErr(WaitlistHandlers.reject, { id }, SYSTEM_ADMIN);

    expect(failure.httpStatus).toBe(422);
    expect(await invitationStatuses()).toEqual(["accepted"]);
    const [entry] = (await entries()).filter((row) => row["id"] === id);
    expect(entry?.["status"]).toBe("invited");
  });

  test("reject is refused for a member whose invitation a tenant admin reset to pending", async () => {
    const email = "admin-reinvite@example.com";
    const { id, tenantId } = await inviteAndAccept(email);
    const tenantAdmin: SessionUser = { id: SYSTEM_ADMIN.id, tenantId, roles: ["TenantAdmin"] };
    await stack.http.writeOk(AuthHandlers.inviteCreate, { email, role: "Editor" }, tenantAdmin);
    expect(await invitationStatuses()).toEqual(["pending"]);

    const failure = await stack.http.writeErr(WaitlistHandlers.reject, { id }, SYSTEM_ADMIN);

    expect(failure.httpStatus).toBe(422);
    expect(failure.details).toMatchObject({ reason: "waitlist_not_rejectable" });
    const { id: userId } = await userRowOf(stack, email);
    expect(await selectMany(stack.db, tenantMembershipsTable, { userId, tenantId })).toHaveLength(
      1,
    );
    const [entry] = (await entries()).filter((row) => row["id"] === id);
    expect(entry?.["status"]).toBe("invited");
  });
});

describe("waitlist GDPR", () => {
  test("a user with the same but unverified email gets no export rows and forget keeps the entry", async () => {
    const email = "unverified@example.com";
    const entryId = await submitAndGetId(email, { message: "mine" });

    const { id: userId } = await seedUser(stack.db, {
      email,
      displayName: "Squatter",
      passwordHash: "hashed",
      emailVerified: false,
    });
    await seedRow(stack.db, tenantMembershipsTable, {
      tenantId: crypto.randomUUID(),
      userId,
      roles: '["Member"]',
    });

    const bundle = await runUserExport({
      db: stack.db,
      registry: stack.registry,
      userId,
      now: Temporal.Now.instant(),
    });
    const snippets = bundle.tenants
      .flatMap((section) => section.entities)
      .filter((snippet) => snippet.entity === "waitlistEntry");
    expect(snippets).toHaveLength(0);

    await requestUserDeletion(userId);
    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: Temporal.Now.instant(),
    });
    expect(result.errors).toHaveLength(0);
    expect(result.processedUserIds).toContain(userId);

    const [entry] = (await entries()).filter((row) => row["id"] === entryId);
    expect(entry?.["email"]).toBe(email);
    expect(entry?.["name"]).toBe("Ada Lovelace");
  });

  test("export lists the entry and forget erases it for a user with the same email", async () => {
    const email = "gdpr@example.com";
    await submitAndGetId(email, { message: "hello" });

    const userId = crypto.randomUUID();
    const tenantId = crypto.randomUUID();
    await seedRow(stack.db, userTable, {
      id: userId,
      tenantId: SYSTEM_TENANT_ID,
      email,
      passwordHash: "hashed",
      displayName: "Gdpr User",
      locale: "en",
      emailVerified: true,
      roles: "[]",
      status: USER_STATUS.DeletionRequested,
      gracePeriodEnd: Temporal.Now.instant().subtract({ minutes: 1 }),
    });
    await seedRow(stack.db, tenantMembershipsTable, { tenantId, userId, roles: '["Member"]' });

    const bundle = await runUserExport({
      db: stack.db,
      registry: stack.registry,
      userId,
      now: Temporal.Now.instant(),
    });
    const snippets = bundle.tenants
      .flatMap((section) => section.entities)
      .filter((snippet) => snippet.entity === "waitlistEntry");
    expect(snippets.length).toBeGreaterThan(0);
    expect(String(snippets[0]?.rows[0]?.["email"])).toBe(email);

    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: Temporal.Now.instant(),
    });
    expect(result.errors).toHaveLength(0);
    expect(result.processedUserIds).toContain(userId);

    const remaining = await entries();
    expect(remaining.every((row) => row["email"] !== email)).toBe(true);
  });

  test("with KMS and blind index active, forget erases the encrypted entry", async () => {
    configurePiiSubjectKms(new InMemoryKmsAdapter());
    configureBlindIndexKey(Buffer.alloc(32, 7).toString("base64"));
    try {
      const email = "gdpr-kms@example.com";
      expect((await submit(validBody(email, { message: "secret note" }))).status).toBe(200);
      const [created] = await entries();
      const entryId = String(created?.["id"]);
      const [stored] = (await entries()).filter((row) => row["id"] === entryId);
      expect(JSON.stringify(stored)).not.toContain("secret note");

      const { id: userId } = await seedUser(stack.db, {
        email,
        displayName: "Kms User",
        passwordHash: "hashed",
        emailVerified: true,
      });
      await seedRow(stack.db, tenantMembershipsTable, {
        tenantId: crypto.randomUUID(),
        userId,
        roles: '["Member"]',
      });

      const bundle = await runUserExport({
        db: stack.db,
        registry: stack.registry,
        userId,
        now: Temporal.Now.instant(),
      });
      const snippet = bundle.tenants
        .flatMap((section) => section.entities)
        .find((entity) => entity.entity === "waitlistEntry");
      expect(snippet?.rows[0]?.["message"]).toBe("secret note");

      await requestUserDeletion(userId);
      const result = await runForgetCleanup({
        db: stack.db,
        registry: stack.registry,
        now: Temporal.Now.instant(),
      });
      expect(result.errors).toHaveLength(0);
      expect(result.processedUserIds).toContain(userId);

      const [after] = (await entries()).filter((row) => row["id"] === entryId);
      expect(after?.["name"]).not.toBe("Ada Lovelace");
    } finally {
      resetPiiSubjectKmsForTests();
      resetBlindIndexKeyForTests();
    }
  });
});
