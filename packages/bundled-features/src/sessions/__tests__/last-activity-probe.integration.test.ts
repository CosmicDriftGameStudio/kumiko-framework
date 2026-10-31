import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  createManualClock,
  createTestEnvelopeCipher,
  resetTestTables,
} from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { createTenantFeature } from "../../tenant/index.ts";
import { createUserFeature } from "../../user/feature.ts";
import { createSessionsFeature } from "../feature.ts";
import { userSessionTable } from "../schema/user-session.ts";
import { createSessionCallbacks } from "../session-callbacks.ts";

const PROBE_PATH = "/sessions/last-activity";
const SECRET = "p".repeat(40);
const FIRST = Temporal.Instant.from("2030-03-01T08:00:00Z");
const SECOND = Temporal.Instant.from("2030-03-02T09:30:00Z");
const clock = createManualClock(FIRST);
const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));

function features(probeSecret?: string) {
  return [
    createConfigFeature(),
    createUserFeature(),
    createTenantFeature(),
    createAuthFoundationFeature(),
    createSessionsFeature(
      probeSecret === undefined ? {} : { lastActivityProbeSecret: probeSecret },
    ),
  ];
}

const extraContext = {
  configResolver: createConfigResolver({ cipher: encryption }),
  configEncryption: encryption,
};

async function probe(stack: TestStack, authorization?: string): Promise<Response> {
  return stack.http.raw("GET", PROBE_PATH, undefined, authorization ? { authorization } : {});
}

describe("sessions last-activity probe", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({ features: features(SECRET), extraContext });
  });
  afterAll(async () => {
    await stack.cleanup();
  });
  beforeEach(async () => {
    await resetTestTables(stack.db, [userSessionTable]);
    await stack.redis.flushNamespace();
  });

  test("a wrong or missing secret gets 401", async () => {
    expect((await probe(stack)).status).toBe(401);
    expect((await probe(stack, "Bearer wrong")).status).toBe(401);
    expect((await probe(stack, `Bearer ${SECRET}x`)).status).toBe(401);
  });

  test("/api/query never answers the probe, not even with the right secret", async () => {
    const anonymous = await stack.http.raw("POST", "/api/query", {
      type: "sessions:query:last-activity-probe",
      payload: { bearerToken: SECRET },
    });
    expect(anonymous.status).toBe(401);
    const signedIn = await stack.http.query(
      "sessions:query:last-activity-probe",
      { bearerToken: SECRET },
      TestUsers.admin,
    );
    expect(signedIn.status).toBe(403);
    expect(await signedIn.text()).not.toContain("lastActivityAt");
  });

  test("the right secret returns the newest lastSeenAt across tenants, or null without sessions", async () => {
    const empty = await probe(stack, `Bearer ${SECRET}`);
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ lastActivityAt: null });

    const callbacks = createSessionCallbacks({ db: stack.db, clock });
    const meta = { ip: "127.0.0.1", userAgent: "test" };
    clock.set(FIRST);
    await callbacks.sessionCreator({ ...TestUsers.admin, tenantId: testTenantId(1) }, meta);
    clock.set(SECOND);
    await callbacks.sessionCreator({ ...TestUsers.admin, tenantId: testTenantId(2) }, meta);
    clock.set(FIRST.add({ hours: 1 }));
    await callbacks.sessionCreator({ ...TestUsers.admin, tenantId: testTenantId(1) }, meta);

    const answered = await probe(stack, `Bearer ${SECRET}`);
    expect(answered.status).toBe(200);
    expect(await answered.json()).toEqual({ lastActivityAt: SECOND.toString() });
  });

  test("an injected clock stamps new sessions", async () => {
    clock.set(SECOND);
    const callbacks = createSessionCallbacks({ db: stack.db, clock });
    await callbacks.sessionCreator(TestUsers.admin, { ip: "127.0.0.1", userAgent: "test" });
    const [row] = await selectMany<{ createdAt: Temporal.Instant; expiresAt: Temporal.Instant }>(
      stack.db,
      userSessionTable,
      {},
    );
    expect(row?.createdAt.toString()).toBe(SECOND.toString());
    expect(row?.expiresAt.epochMilliseconds).toBeGreaterThan(SECOND.epochMilliseconds);
  });
});

describe("sessions without the probe option", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({ features: features(), extraContext });
  });
  afterAll(async () => {
    await stack.cleanup();
  });

  test("there is no probe route, not even for the would-be secret", async () => {
    expect((await probe(stack, `Bearer ${SECRET}`)).status).toBe(404);
  });
});
