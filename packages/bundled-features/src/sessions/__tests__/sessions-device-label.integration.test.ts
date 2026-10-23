import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  createLateBoundHolder,
  createTestEnvelopeCipher,
  resetTestTables,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import * as jose from "jose";
import * as z from "zod";
import { createAuthEmailPasswordFeature } from "../../auth-email-password/feature.ts";
import { AuthHandlers } from "../../auth-email-password/web/constants.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { createTenantFeature } from "../../tenant/index.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { createUserFeature } from "../../user/feature.ts";
import { userEntity, userTable } from "../../user/schema/user.ts";
import { SessionQueries } from "../constants.ts";
import { createSessionsFeature } from "../feature.ts";
import { userSessionEntity, userSessionTable } from "../schema/user-session.ts";
import { createSessionCallbacks, type SessionCallbacks } from "../session-callbacks.ts";
import { sessionCallbacksFromLateBound } from "../testing.ts";
import { makeSessionHelpers } from "./test-helpers.ts";

const CHROME_ON_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const UNKNOWN_CLIENT = "curl/8.7.1";
const PASSWORD = "pw-long-enough";

let stack: TestStack;
let h: ReturnType<typeof makeSessionHelpers>;
const callbacks = createLateBoundHolder<SessionCallbacks>("session-callbacks");
const encryptionKey = randomBytes(32).toString("base64");
const TENANT: TenantId = testTenantId(1);

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
      createAuthFoundationFeature(),
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
  h = makeSessionHelpers(stack, TENANT, bound.asAuthConfig().sessionCreator);

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, userSessionEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [
    userTable,
    tenantMembershipsTable,
    userSessionTable,
    eventsTable,
  ]);
  await stack.redis.flushNamespace();
});

const loginResponseSchema = z.object({ token: z.string() });
const deviceFieldsSchema = z.object({
  id: z.string(),
  deviceLabel: z.string().nullable(),
  device: z.unknown(),
});
const deviceRowsSchema = z.object({ rows: z.array(deviceFieldsSchema) });

async function loginWithUserAgent(
  email: string,
  userAgent: string,
): Promise<{ token: string; sid: string }> {
  const res = await stack.http.raw(
    "POST",
    "/api/auth/login",
    { email, password: PASSWORD },
    { "User-Agent": userAgent },
  );
  expect(res.status).toBe(200);
  const { token } = loginResponseSchema.parse(await res.json());
  const sid = jose.decodeJwt(token).jti;
  if (typeof sid !== "string") throw new Error("login did not emit a sid");
  return { token, sid };
}

async function queryAs<T extends z.ZodType>(
  token: string,
  type: string,
  payload: object,
  schema: T,
): Promise<z.infer<T>> {
  const res = await h.authedPost("/api/query", token, { type, payload });
  expect(res.status).toBe(200);
  const envelope = z.object({ data: z.unknown() }).parse(await res.json());
  return schema.parse(envelope.data);
}

describe("sessions queries expose a ready-made deviceLabel", () => {
  test("list, mine and detail return the label for a known user agent and null for an unknown one", async () => {
    await h.seedUser("device@example.com", PASSWORD, { roles: ["Admin"] });
    const known = await loginWithUserAgent("device@example.com", CHROME_ON_MAC);
    const unknown = await loginWithUserAgent("device@example.com", UNKNOWN_CLIENT);

    for (const type of [SessionQueries.list, SessionQueries.mine]) {
      const { rows } = await queryAs(known.token, type, {}, deviceRowsSchema);
      expect(rows.find((r) => r.id === known.sid)?.deviceLabel).toBe("Chrome 141 · macOS");
      expect(rows.find((r) => r.id === unknown.sid)?.deviceLabel).toBeNull();
    }

    const knownDetail = await queryAs(
      known.token,
      SessionQueries.detail,
      { id: known.sid },
      deviceFieldsSchema,
    );
    expect(knownDetail.deviceLabel).toBe("Chrome 141 · macOS");
    expect(knownDetail.device).toEqual({ browser: "Chrome", browserMajor: 141, os: "macOS" });

    const unknownDetail = await queryAs(
      known.token,
      SessionQueries.detail,
      { id: unknown.sid },
      deviceFieldsSchema,
    );
    expect(unknownDetail.deviceLabel).toBeNull();
    expect(unknownDetail.device).toBeNull();
  });
});
