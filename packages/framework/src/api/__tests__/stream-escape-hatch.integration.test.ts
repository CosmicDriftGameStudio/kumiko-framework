// fw#(stream escapeHatch) — mirrors system-identity-switch.integration.test.ts's
// coverage of ctx.queryAs(SYSTEM, ...) gating, but for stream handlers: a
// StreamHandlerDef can now declare `escapeHatch: { reason }` to switch
// identity to SYSTEM. Real HTTP calls (SSE POST /api/stream via Hono's
// in-memory app.request) + setupTestStack — never createTestDispatcher.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createLiveDispatcher } from "@cosmicdrift/kumiko-dispatcher-live";
import * as z from "zod";
import { generateToken } from "../../api/tokens";
import { createSystemUser, defineFeature } from "../../engine";
import type { SessionUser } from "../../engine/types";
import { createTestUser, setupTestStack, type TestStack, TestUsers } from "../../stack";

const user = TestUsers.user;
const otherUserNoRole: SessionUser = createTestUser({
  id: 60,
  tenantId: user.tenantId,
  roles: ["User"],
});
const otherUserWithAdminRole: SessionUser = createTestUser({
  id: 61,
  tenantId: user.tenantId,
  roles: ["Admin"],
});

const streamProbeFeature = defineFeature("stream-idswitch-probe", (r) => {
  r.queryHandler(
    "whoami",
    z.object({}),
    async (query) => ({ roles: query.user.roles, tenantId: query.user.tenantId }),
    { access: { roles: ["system", "User"] } },
  );

  r.queryHandler("admin-only", z.object({}), async () => ({ ok: true }), {
    access: { roles: ["Admin"] },
  });

  // --- ctx.queryAs(SYSTEM, ...) from a stream handler: gated by the
  // stream handler's own escapeHatch, same contract as write/query. ---
  r.streamHandler(
    "query-as-system-no-hatch",
    z.object({}),
    async function* (query, ctx) {
      const result = await ctx.queryAs(
        createSystemUser(query.user.tenantId),
        "stream-idswitch-probe:query:whoami",
        {},
      );
      yield result;
    },
    { access: { roles: ["User"] } },
  );

  r.streamHandler(
    "query-as-system-with-hatch",
    z.object({}),
    async function* (query, ctx) {
      const result = await ctx.queryAs(
        createSystemUser(query.user.tenantId),
        "stream-idswitch-probe:query:whoami",
        {},
      );
      yield result;
    },
    {
      access: { roles: ["User"] },
      escapeHatch: { reason: "test: stream needs SYSTEM to look itself up" },
    },
  );

  // --- ctx.queryAs(nonSystemUser, ...) from a stream handler (fw#2876): a foreign
  // user needs the stream handler's escapeHatch; the target's own access rule still applies. ---
  r.streamHandler(
    "query-as-normal-user-no-hatch",
    z.object({}),
    async function* (_query, ctx) {
      yield await ctx.queryAs(otherUserWithAdminRole, "stream-idswitch-probe:query:admin-only", {});
    },
    { access: { roles: ["User"] } },
  );

  r.streamHandler(
    "query-as-normal-user",
    z.object({ granted: z.boolean() }),
    async function* (query, ctx) {
      const result = await ctx.queryAs(
        query.payload.granted ? otherUserWithAdminRole : otherUserNoRole,
        "stream-idswitch-probe:query:admin-only",
        {},
      );
      yield result;
    },
    {
      access: { roles: ["User"] },
      escapeHatch: { reason: "test: stream reads admin-only data as a named colleague" },
    },
  );
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [streamProbeFeature] });
});

afterAll(async () => {
  await stack.cleanup();
});

async function buildDispatcherFor(asUser: SessionUser) {
  const authJwt = await stack.jwt.sign(asUser);
  const csrfToken = generateToken();
  const cookieHeader = `kumiko_auth=${authJwt}; kumiko_csrf=${csrfToken}`;
  const fetchImpl = (async (url: unknown, init: RequestInit | undefined) => {
    return stack.app.request(String(url), {
      ...(init ?? {}),
      headers: { ...(init?.headers ?? {}), Cookie: cookieHeader },
    });
  }) as unknown as typeof fetch;
  return createLiveDispatcher({ fetch: fetchImpl, readCsrf: () => csrfToken });
}

async function collectAll<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const chunks: T[] = [];
  for await (const chunk of gen) chunks.push(chunk);
  return chunks;
}

describe("ctx.queryAs(SYSTEM, ...) from a stream handler — gated by the handler's own escapeHatch", () => {
  test("WITHOUT escapeHatch: fails with access_denied", async () => {
    const dispatcher = await buildDispatcherFor(user);
    let thrown: unknown;
    try {
      for await (const _ of dispatcher.stream(
        "stream-idswitch-probe:stream:query-as-system-no-hatch",
        {},
      )) {
        // should not yield
      }
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toMatchObject({ code: "access_denied" });
  });

  test("WITH escapeHatch: succeeds", async () => {
    const dispatcher = await buildDispatcherFor(user);
    const chunks = await collectAll(
      dispatcher.stream<{ roles: readonly string[] }>(
        "stream-idswitch-probe:stream:query-as-system-with-hatch",
        {},
      ),
    );
    expect(chunks[0]?.roles).toContain("system");
  });
});

describe("ctx.queryAs(nonSystemUser, ...) from a stream handler — gated like write/query (fw#2876)", () => {
  test("WITHOUT escapeHatch: a foreign user fails with identity_switch_denied", async () => {
    const dispatcher = await buildDispatcherFor(user);
    let thrown: unknown;
    try {
      for await (const _ of dispatcher.stream(
        "stream-idswitch-probe:stream:query-as-normal-user-no-hatch",
        {},
      )) {
        // should not yield
      }
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toMatchObject({
      code: "access_denied",
      details: { reason: "identity_switch_denied" },
    });
  });

  test("WITH escapeHatch, delegates to the target's own access check: denied when the target user lacks the role", async () => {
    const dispatcher = await buildDispatcherFor(user);
    let thrown: unknown;
    try {
      for await (const _ of dispatcher.stream("stream-idswitch-probe:stream:query-as-normal-user", {
        granted: false,
      })) {
        // should not yield
      }
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toMatchObject({ code: "access_denied" });
  });

  test("WITH escapeHatch, delegates to the target's own access check: allowed when the target user has the role", async () => {
    const dispatcher = await buildDispatcherFor(user);
    const chunks = await collectAll(
      dispatcher.stream<{ ok: boolean }>("stream-idswitch-probe:stream:query-as-normal-user", {
        granted: true,
      }),
    );
    expect(chunks[0]?.ok).toBe(true);
  });
});
