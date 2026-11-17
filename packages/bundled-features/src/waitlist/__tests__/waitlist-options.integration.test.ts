import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { createTenantDb } from "@cosmicdrift/kumiko-framework/internal/row-level-security";
import { type SessionUser, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { TenantHandlers } from "../../tenant/web/constants.ts";
import { waitlistEntryTable } from "../entity.ts";
import { importWaitlistEntry } from "../import.ts";
import { WAITLIST_FIELD_LIMITS, WAITLIST_STATUS, WaitlistHandlers } from "../web/constants.ts";
import {
  acceptInviteAsNewUser,
  createWaitlistTestStack,
  mailsTo,
  resetWaitlistTestState,
  SYSTEM_ADMIN,
  signUpOpenly,
} from "./waitlist-test-stack.ts";

const TENANT_ADMIN: SessionUser = {
  id: crypto.randomUUID(),
  tenantId: crypto.randomUUID(),
  roles: ["TenantAdmin"],
};

function submitOn(target: TestStack, email: string) {
  return target.http.raw(
    "POST",
    "/api/write",
    {
      type: WaitlistHandlers.submit,
      payload: { name: "Ada Lovelace", email, locale: "en", message: "hello" },
    },
    { "x-forwarded-for": "198.51.100.9" },
  );
}

async function rowsOf(target: TestStack) {
  return selectMany(target.db, waitlistEntryTable, {});
}

describe("waitlist rateLimit option", () => {
  test("the default limits one IP to five submits per window", async () => {
    const limited = await createWaitlistTestStack({ emailRateLimits: [] });
    try {
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 6; attempt += 1) {
        statuses.push((await submitOn(limited, `l${attempt}@example.com`)).status);
      }
      expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    } finally {
      await limited.cleanup();
    }
  });

  test("{ disabled: true } leaves repeated submits from one IP unlimited", async () => {
    const open = await createWaitlistTestStack({
      emailRateLimits: [],
      rateLimit: { disabled: true, reason: "a CDN throttles the route upstream" },
    });
    try {
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 8; attempt += 1) {
        statuses.push((await submitOn(open, `o${attempt}@example.com`)).status);
      }
      expect(statuses.every((status) => status === 200)).toBe(true);
    } finally {
      await open.cleanup();
    }
  });

  test("a custom limit replaces the default", async () => {
    const custom = await createWaitlistTestStack({
      emailRateLimits: [],
      rateLimit: { per: "ip+handler", limit: 2, windowSeconds: 600 },
    });
    try {
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 3; attempt += 1) {
        statuses.push((await submitOn(custom, `c${attempt}@example.com`)).status);
      }
      expect(statuses).toEqual([200, 200, 429]);
    } finally {
      await custom.cleanup();
    }
  });
});

describe("waitlist export and purge", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await createWaitlistTestStack({ rateLimit: { disabled: true, reason: "test" } });
  });
  afterAll(async () => {
    await stack.cleanup();
  });
  beforeEach(async () => {
    await resetWaitlistTestState(stack);
  });

  test("export hands over every entry with its personal data and needs SystemAdmin", async () => {
    await submitOn(stack, "first@example.com");
    await submitOn(stack, "second@example.com");

    const exported = await stack.http.writeOk<{
      count: number;
      entries: readonly { email: string; name: string; message: string }[];
    }>(WaitlistHandlers.export, {}, SYSTEM_ADMIN);
    expect(exported.count).toBe(2);
    expect(exported.entries.map((entry) => entry.email).sort()).toEqual([
      "first@example.com",
      "second@example.com",
    ]);
    expect(exported.entries[0]?.name).toBe("Ada Lovelace");
    expect(exported.entries[0]?.message).toBe("hello");

    const denied = await stack.http.writeErr(WaitlistHandlers.export, {}, TENANT_ADMIN);
    expect(denied.httpStatus).toBe(403);
    const anonymous = await stack.http.raw("POST", "/api/write", {
      type: WaitlistHandlers.export,
      payload: {},
    });
    expect([401, 403]).toContain(anonymous.status);
  });

  test("purge refuses a stale confirmCount and keeps the entries", async () => {
    await submitOn(stack, "keep@example.com");
    const failure = await stack.http.writeErr(
      WaitlistHandlers.purge,
      { confirmCount: 5 },
      SYSTEM_ADMIN,
    );
    expect(failure.httpStatus).toBe(422);
    expect(await rowsOf(stack)).toHaveLength(1);
  });

  test("purge erases every entry when the count matches and refuses non-admins", async () => {
    await submitOn(stack, "gone1@example.com");
    await submitOn(stack, "gone2@example.com");

    const denied = await stack.http.writeErr(
      WaitlistHandlers.purge,
      { confirmCount: 2 },
      TENANT_ADMIN,
    );
    expect(denied.httpStatus).toBe(403);
    expect(await rowsOf(stack)).toHaveLength(2);

    const purged = await stack.http.writeOk<{ purged: number }>(
      WaitlistHandlers.purge,
      { confirmCount: 2 },
      SYSTEM_ADMIN,
    );
    expect(purged.purged).toBe(2);
    expect(await rowsOf(stack)).toHaveLength(0);
    const after = await stack.http.writeOk<{ count: number }>(
      WaitlistHandlers.export,
      {},
      SYSTEM_ADMIN,
    );
    expect(after.count).toBe(0);
  });

  test("exportPurge: false leaves both handlers out", async () => {
    const without = await createWaitlistTestStack({ exportPurge: false });
    try {
      const res = await without.http.raw(
        "POST",
        "/api/write",
        { type: WaitlistHandlers.export, payload: {} },
        { "x-test-user": "ignored" },
      );
      expect(res.status).not.toBe(200);
      const failure = await without.http.writeErr(WaitlistHandlers.export, {}, SYSTEM_ADMIN);
      expect(failure.httpStatus).toBe(404);
    } finally {
      await without.cleanup();
    }
  });
});

describe("waitlist linkOnSignup option", () => {
  async function inviteAndAccept(target: TestStack, email: string): Promise<string> {
    await submitOn(target, email);
    const [entry] = await rowsOf(target);
    const invited = await target.http.writeOk<{ tenantId: string }>(
      WaitlistHandlers.invite,
      { id: String(entry?.["id"]) },
      SYSTEM_ADMIN,
    );
    await acceptInviteAsNewUser(target, email);
    return invited.tenantId;
  }

  test("accepting the invite as first tenant admin marks the entry provisioned", async () => {
    const linking = await createWaitlistTestStack({
      linkOnSignup: true,
      rateLimit: { disabled: true, reason: "test" },
    });
    try {
      const tenantId = await inviteAndAccept(linking, "linked@example.com");
      await waitFor(async () => {
        await linking.eventDispatcher?.runOnce();
        const [current] = await rowsOf(linking);
        expect(current?.["status"]).toBe(WAITLIST_STATUS.Provisioned);
      });
      const [entry] = await rowsOf(linking);
      expect(entry?.["status"]).toBe(WAITLIST_STATUS.Provisioned);
      expect(entry?.["linkedTenantId"]).toBe(tenantId);
      expect(entry?.["provisionedAt"]).toBeDefined();
    } finally {
      await linking.cleanup();
    }
  });

  test("open signup with an invited email marks the entry provisioned with the new tenant", async () => {
    const linking = await createWaitlistTestStack({
      linkOnSignup: true,
      rateLimit: { disabled: true, reason: "test" },
    });
    try {
      await submitOn(linking, "open-signup@example.com");
      const [submitted] = await rowsOf(linking);
      const invited = await linking.http.writeOk<{ tenantId: string }>(
        WaitlistHandlers.invite,
        { id: String(submitted?.["id"]) },
        SYSTEM_ADMIN,
      );
      await signUpOpenly(linking, "open-signup@example.com");
      await waitFor(async () => {
        await linking.eventDispatcher?.runOnce();
        const [current] = await rowsOf(linking);
        expect(current?.["status"]).toBe(WAITLIST_STATUS.Provisioned);
      });
      const [entry] = await rowsOf(linking);
      expect(typeof entry?.["linkedTenantId"]).toBe("string");
      expect(entry?.["linkedTenantId"]).not.toBe(invited.tenantId);
    } finally {
      await linking.cleanup();
    }
  });

  test("shared-tenant mode links the first member only; a later TenantAdmin joining stays invited", async () => {
    const sharedTenantId = testTenantId(77);
    const shared = await createWaitlistTestStack({
      linkOnSignup: true,
      rateLimit: { disabled: true, reason: "test" },
      invite: { mode: "shared-tenant", tenantId: sharedTenantId, role: "TenantAdmin" },
    });
    try {
      await shared.http.writeOk(
        TenantHandlers.create,
        { id: sharedTenantId, key: "shared-waitlist", name: "Shared" },
        SYSTEM_ADMIN,
      );
      const statusOf = async (email: string) =>
        (await rowsOf(shared)).find((row) => row["email"] === email)?.["status"];
      const inviteAndAcceptEmail = async (email: string) => {
        await submitOn(shared, email);
        const entry = (await rowsOf(shared)).find((row) => row["email"] === email);
        await shared.http.writeOk(
          WaitlistHandlers.invite,
          { id: String(entry?.["id"]) },
          SYSTEM_ADMIN,
        );
        await acceptInviteAsNewUser(shared, email);
      };

      await inviteAndAcceptEmail("first-member@example.com");
      await waitFor(async () => {
        await shared.eventDispatcher?.runOnce();
        expect(await statusOf("first-member@example.com")).toBe(WAITLIST_STATUS.Provisioned);
      });

      await inviteAndAcceptEmail("later-admin@example.com");
      await shared.eventDispatcher?.runOnce();
      expect(await statusOf("later-admin@example.com")).toBe(WAITLIST_STATUS.Invited);
      expect(await statusOf("first-member@example.com")).toBe(WAITLIST_STATUS.Provisioned);
    } finally {
      await shared.cleanup();
    }
  });

  test("without the option the entry stays invited", async () => {
    const plain = await createWaitlistTestStack({
      rateLimit: { disabled: true, reason: "test" },
    });
    try {
      await inviteAndAccept(plain, "unlinked@example.com");
      const [entry] = await rowsOf(plain);
      expect(entry?.["status"]).toBe(WAITLIST_STATUS.Invited);
      expect(entry?.["provisionedAt"] ?? null).toBeNull();
    } finally {
      await plain.cleanup();
    }
  });
});

describe("waitlist adminLocale option", () => {
  test("the admin notice follows adminLocale, not the entrant's form or request locale", async () => {
    const localized = await createWaitlistTestStack({
      notifyRecipient: () => "admin-locale-ops@example.com",
      adminLocale: "de",
      rateLimit: { disabled: true, reason: "test" },
    });
    try {
      const res = await localized.http.raw(
        "POST",
        "/api/write",
        {
          type: WaitlistHandlers.submit,
          payload: { name: "Ada Lovelace", email: "ada-es@example.com", locale: "es" },
        },
        { "x-forwarded-for": "198.51.100.10", "accept-language": "es-ES" },
      );
      expect(res.status).toBe(200);
      expect(mailsTo("admin-locale-ops@example.com").map((mail) => mail.subject)).toEqual([
        "Neuer Wartelisten-Eintrag: Ada Lovelace",
      ]);
    } finally {
      await localized.cleanup();
    }
  });
});

describe("waitlist import", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await createWaitlistTestStack({});
  });
  afterAll(async () => {
    await stack.cleanup();
  });
  beforeEach(async () => {
    await resetWaitlistTestState(stack);
  });

  test("importWaitlistEntry keeps the same source key on one id", async () => {
    const db = createTenantDb({
      db: stack.db,
      tenantId: SYSTEM_TENANT_ID,
      mode: "system",
      reason: "test reads system-tenant waitlist rows",
    });
    const entry = {
      sourceKey: `x:${crypto.randomUUID()}`,
      name: "N",
      email: "n@example.com",
      locale: "en",
      status: WAITLIST_STATUS.Pending,
      submittedAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
    } as const;
    expect(await importWaitlistEntry(db, entry)).toBe("created");
    expect(await importWaitlistEntry(db, entry)).toBe("skipped");
  });

  test("importWaitlistEntry refuses an entry above a submit field limit", async () => {
    const db = createTenantDb({
      db: stack.db,
      tenantId: SYSTEM_TENANT_ID,
      mode: "system",
      reason: "test reads system-tenant waitlist rows",
    });
    const entry = {
      sourceKey: `x:${crypto.randomUUID()}`,
      name: "N",
      email: "n@example.com",
      locale: "en",
      status: WAITLIST_STATUS.Pending,
      submittedAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
      message: "m".repeat(WAITLIST_FIELD_LIMITS.message + 1),
    } as const;
    await expect(importWaitlistEntry(db, entry)).rejects.toThrow("exceeds a field length limit");
    expect(await rowsOf(stack)).toEqual([]);
  });
});
