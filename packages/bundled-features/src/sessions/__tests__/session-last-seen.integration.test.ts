import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import type { SessionCreator } from "@cosmicdrift/kumiko-framework/api";
import { asRawClient, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  createLateBoundHolder,
  createTestEnvelopeCipher,
  updateRows,
} from "@cosmicdrift/kumiko-framework/testing";
import { Temporal } from "temporal-polyfill";
import { AuthHandlers } from "../../auth-email-password/constants";
import { createAuthEmailPasswordFeature } from "../../auth-email-password/feature";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createTenantFeature } from "../../tenant";
import { tenantMembershipsTable } from "../../tenant/membership-table";
import { tenantEntity } from "../../tenant/schema/tenant";
import { createUserFeature } from "../../user/feature";
import { userEntity, userTable } from "../../user/schema/user";
import { LAST_SEEN_REFRESH_MS } from "../constants";
import { createSessionsFeature } from "../feature";
import { userSessionEntity, userSessionTable } from "../schema/user-session";
import { createSessionCallbacks, type SessionCallbacks } from "../session-callbacks";
import { sessionCallbacksFromLateBound } from "../testing";
import { makeSessionHelpers } from "./test-helpers";

// Proves the #2220 lastSeenAt refresh: sessionChecker stamps a coarse
// activity marker on the session row, but only once per LAST_SEEN_REFRESH_MS
// rather than on every authenticated request.

let stack: TestStack;
let h: ReturnType<typeof makeSessionHelpers>;
let sessionCreator: SessionCreator;
const callbacks = createLateBoundHolder<SessionCallbacks>("session-callbacks");

const encryptionKey = randomBytes(32).toString("base64");

const TENANT: TenantId = testTenantId(1);

async function readLastSeenAt(sid: string): Promise<Temporal.Instant | null> {
  const rows = await selectMany<{ lastSeenAt: Temporal.Instant | null }>(
    stack.db,
    userSessionTable,
    { id: sid },
  );
  return rows[0]?.lastSeenAt ?? null;
}

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(encryptionKey);
  const resolver = createConfigResolver({ cipher: encryption });
  const bound = sessionCallbacksFromLateBound(callbacks);

  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createAuthEmailPasswordFeature(),
      authFoundationFeature,
      createSessionsFeature(),
    ],
    extraContext: { configResolver: resolver, configEncryption: encryption },
    authConfig: {
      ...bound.asAuthConfig(),
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
    },
  });
  callbacks.set(createSessionCallbacks({ db: stack.db }));
  const creator = bound.asAuthConfig().sessionCreator;
  if (!creator) throw new Error("sessionCreator missing from bound auth config");
  sessionCreator = creator;
  h = makeSessionHelpers(stack, TENANT, sessionCreator);

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
  await unsafeCreateEntityTable(stack.db, userSessionEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantMembershipsTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userSessionTable.tableName}"`);
});

describe("sessionChecker — lastSeenAt refresh", () => {
  test("freshly created session has lastSeenAt set, not null", async () => {
    await h.seedUser("fresh@example.com", "pw-long-enough");
    const { sid } = await h.login("fresh@example.com", "pw-long-enough");

    const lastSeenAt = await readLastSeenAt(sid);
    expect(lastSeenAt).not.toBeNull();
    // Sanity: stamped at creation time, not far in the past/future.
    const driftMs = Math.abs(
      Temporal.Now.instant().epochMilliseconds - (lastSeenAt?.epochMilliseconds ?? 0),
    );
    expect(driftMs).toBeLessThan(10_000);
  });

  test("null lastSeenAt is refreshed to a fresh value on check", async () => {
    const { userId } = await h.seedUser("null-refresh@example.com", "pw-long-enough");
    const { sid } = await h.login("null-refresh@example.com", "pw-long-enough");

    await updateRows(stack.db, userSessionTable, { lastSeenAt: null }, { id: sid });
    expect(await readLastSeenAt(sid)).toBeNull();

    await callbacks.get().sessionChecker(sid, userId);

    const refreshed = await readLastSeenAt(sid);
    expect(refreshed).not.toBeNull();
    const driftMs = Math.abs(
      Temporal.Now.instant().epochMilliseconds - (refreshed?.epochMilliseconds ?? 0),
    );
    expect(driftMs).toBeLessThan(10_000);
  });

  test("lastSeenAt older than LAST_SEEN_REFRESH_MS is refreshed to a fresh value on check", async () => {
    const { userId } = await h.seedUser("stale-refresh@example.com", "pw-long-enough");
    const { sid } = await h.login("stale-refresh@example.com", "pw-long-enough");

    const stale = Temporal.Now.instant().subtract({ milliseconds: LAST_SEEN_REFRESH_MS + 1_000 });
    await updateRows(stack.db, userSessionTable, { lastSeenAt: stale }, { id: sid });
    expect((await readLastSeenAt(sid))?.epochMilliseconds).toBe(stale.epochMilliseconds);

    await callbacks.get().sessionChecker(sid, userId);

    const refreshed = await readLastSeenAt(sid);
    expect(refreshed?.epochMilliseconds).toBeGreaterThan(stale.epochMilliseconds);
    const driftMs = Math.abs(
      Temporal.Now.instant().epochMilliseconds - (refreshed?.epochMilliseconds ?? 0),
    );
    expect(driftMs).toBeLessThan(10_000);
  });

  test("lastSeenAt younger than LAST_SEEN_REFRESH_MS is left unchanged on check", async () => {
    const { userId } = await h.seedUser("recent-noop@example.com", "pw-long-enough");
    const { sid } = await h.login("recent-noop@example.com", "pw-long-enough");

    const recent = Temporal.Now.instant().subtract({ milliseconds: 1_000 });
    await updateRows(stack.db, userSessionTable, { lastSeenAt: recent }, { id: sid });
    const before = await readLastSeenAt(sid);
    expect(before?.epochMilliseconds).toBe(recent.epochMilliseconds);

    await callbacks.get().sessionChecker(sid, userId);

    const after = await readLastSeenAt(sid);
    expect(after?.epochMilliseconds).toBe(before?.epochMilliseconds);
  });
});
