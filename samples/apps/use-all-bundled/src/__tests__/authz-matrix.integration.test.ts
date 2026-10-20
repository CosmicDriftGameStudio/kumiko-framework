// Authorization matrix over every handler and httpRoute that the use-all-bundled dev
// composition registers, booted with real sessions (runDevApp) and the screenshot seed
// as victim data in the dev tenant. Three callers per operation: anonymous aimed at the
// victim tenant via X-Tenant, the lowest role (Member) of a tenant, and the TenantAdmin
// of a second tenant carrying the victim's ids.
// The access gate runs before payload validation, so an empty payload that comes back
// 400 proves the caller passed the gate.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type KumikoServerHandle, runDevApp } from "@cosmicdrift/kumiko-dev-server";
import { seedTenant } from "@cosmicdrift/kumiko-dev-server/testing";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import { asRawClient } from "@cosmicdrift/kumiko-framework/db";
import {
  type AccessRule,
  ANONYMOUS_ROLE,
  hasAccess,
  type SessionUser,
} from "@cosmicdrift/kumiko-framework/engine";
import type { InProcessSeededTenant } from "@cosmicdrift/kumiko-testing";
import { PLAYWRIGHT_DEMO_ENV } from "@cosmicdrift/kumiko-testing/e2e/constants";
import { DEV_TENANT_ID } from "../app/auth-constants";
import { devAppOptions } from "../app/dev-app-options";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Outcome = "denied" | "passed" | "rate-limited" | "error";
type Kind = "write" | "query" | "stream";
type Caller =
  | { readonly label: "anonymous"; readonly roles: readonly string[] }
  | { readonly label: "member" | "foreign-admin"; readonly user: SessionUser };

const ENV_KEYS = [
  "JWT_SECRET",
  "KUMIKO_SECRETS_MASTER_KEY_V1",
  "KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION",
] as const;
const savedEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

let handle: KumikoServerHandle;
let attacker: InProcessSeededTenant;
let memberTenant: InProcessSeededTenant;

const MIDDLEWARE_REJECT_CODES = new Set([
  "missing_token",
  "invalid_token",
  "ambiguous_auth",
  "session_invalid",
  "tenant_required",
  "tenant_not_found",
  "tenant_mismatch",
  "invalid_tenant_format",
  "tenant_unavailable",
]);

function errorCode(text: string): string | undefined {
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body !== "object" || body === null || !("error" in body)) return undefined;
    const error = body.error;
    if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
    return typeof error.code === "string" ? error.code : undefined;
  } catch {
    return undefined;
  }
}

// Session-ending handlers run last per caller: a successful logout with an empty payload
// or a self-restriction would otherwise turn every later call of that caller into a 401.
const endsOwnSession = (name: string): boolean =>
  /logout|revoke-all|session:revoke|restrict-account|request-deletion$/.test(name);

function classify(status: number, text = ""): Outcome {
  if (status === 401 || status === 403 || status === 404) return "denied";
  if (status === 400 && MIDDLEWARE_REJECT_CODES.has(errorCode(text) ?? "")) return "denied";
  if (status === 429) return "rate-limited";
  if (status >= 500) return "error";
  return "passed";
}

async function call(
  kind: Kind,
  type: string,
  payload: unknown,
  caller: Caller,
  tenantHeader?: string,
): Promise<{ status: number; text: string }> {
  const http = handle.stack.http;
  let res: Response;
  if (caller.label === "anonymous") {
    res = await http.raw(
      "POST",
      `/api/${kind}`,
      { type, payload },
      tenantHeader ? { "X-Tenant": tenantHeader } : {},
    );
  } else if (kind === "write") {
    res = await http.write(type, payload, caller.user);
  } else if (kind === "query") {
    res = await http.query(type, payload, caller.user);
  } else {
    return { status: -1, text: "" };
  }
  if (kind === "stream") {
    await res.body?.cancel();
    return { status: res.status, text: "" };
  }
  return { status: res.status, text: await res.text() };
}

// The probes of this file are independent requests; running them one after the other made the
// victim-row test last several seconds locally and past the test timeout on a slow CI runner.
async function forEachConcurrent<T>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  for (let start = 0; start < items.length; start += limit) {
    await Promise.all(items.slice(start, start + limit).map(run));
  }
}

const PROBE_CONCURRENCY = 8;

function allHandlers(): Array<{ kind: Kind; name: string; access: AccessRule | undefined }> {
  const registry = handle.stack.registry;
  const list: Array<{ kind: Kind; name: string; access: AccessRule | undefined }> = [];
  for (const [name, def] of registry.getAllWriteHandlers())
    list.push({ kind: "write", name, access: def.access });
  for (const [name, def] of registry.getAllQueryHandlers())
    list.push({ kind: "query", name, access: def.access });
  for (const [name, def] of registry.getAllStreamHandlers())
    list.push({ kind: "stream", name, access: def.access });
  return list;
}

beforeAll(async () => {
  process.env["JWT_SECRET"] = PLAYWRIGHT_DEMO_ENV.JWT_SECRET;
  process.env["KUMIKO_SECRETS_MASTER_KEY_V1"] = PLAYWRIGHT_DEMO_ENV.KUMIKO_SECRETS_MASTER_KEY_V1;
  process.env["KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION"] = "1";
  const { clientEntry: _client, htmlPath: _html, watchDirs: _watch, ...options } = devAppOptions;
  handle = await runDevApp({
    ...options,
    port: 0,
    installSignalHandlers: false,
    stylesheet: false,
  });
  attacker = await seedTenant(handle.stack, { persist: true, users: 1 });
  memberTenant = await seedTenant(handle.stack, { persist: true, users: 1 });
});

afterAll(async () => {
  await handle?.stop();
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function member(): SessionUser {
  const first = memberTenant.members[0];
  if (!first) throw new Error("seedTenant returned no member");
  return first.session;
}

describe("authorization matrix over all bundled handlers", () => {
  test("positive controls: every caller reaches a handler it is entitled to", async () => {
    const memberMe = await call(
      "query",
      "tenant:query:me",
      {},
      { label: "member", user: member() },
    );
    expect(memberMe.status).toBe(200);
    const attackerMe = await call(
      "query",
      "tenant:query:me",
      {},
      { label: "foreign-admin", user: attacker.admin.session },
    );
    expect(attackerMe.status).toBe(200);
    // An anonymous-role handler must be reachable anonymously, else the anonymous column proves nothing.
    const anonymousHandler = allHandlers().find(
      (h) => h.kind === "query" && hasAccess({ roles: [ANONYMOUS_ROLE] }, h.access),
    );
    expect(anonymousHandler).toBeDefined();
    if (anonymousHandler) {
      const res = await call(
        "query",
        anonymousHandler.name,
        {},
        { label: "anonymous", roles: [ANONYMOUS_ROLE] },
      );
      expect(classify(res.status, res.text)).toBe("passed");
    }
  });

  test("no caller passes an access gate its roles do not satisfy", async () => {
    const callers: Caller[] = [
      { label: "anonymous", roles: [ANONYMOUS_ROLE] },
      { label: "member", user: member() },
      { label: "foreign-admin", user: attacker.admin.session },
    ];
    const leaks: string[] = [];
    const inconclusive: string[] = [];
    const reachableAnonymous: string[] = [];
    const reachableMember: string[] = [];
    const anonymousForeignTenantNotRejected: string[] = [];
    const handlers = allHandlers().sort(
      (a, b) => Number(endsOwnSession(a.name)) - Number(endsOwnSession(b.name)),
    );
    const sessionLost = new Map<string, string>();
    let previous = "";
    for (const caller of callers) {
      let checkedAlive = false;
      for (const handler of handlers) {
        if (handler.kind === "stream" && caller.label !== "anonymous") continue;
        if (caller.label !== "anonymous" && endsOwnSession(handler.name) && !checkedAlive) {
          checkedAlive = true;
          // Session still alive right before the session-ending handlers run.
          const alive = await call("query", "tenant:query:me", {}, caller);
          expect({ status: alive.status, lost: sessionLost.get(caller.label) }).toEqual({
            status: 200,
            lost: undefined,
          });
        }
        const roles = caller.label === "anonymous" ? caller.roles : caller.user.roles;
        const expected = hasAccess({ roles }, handler.access);
        const { status, text } = await call(handler.kind, handler.name, {}, caller);
        const outcome = classify(status, text);
        if (errorCode(text) === "session_invalid" && !sessionLost.has(caller.label))
          sessionLost.set(caller.label, `${previous} then ${handler.name}`);
        previous = `${handler.name} ${status} ${text.slice(0, 100)}`;
        if (outcome === "passed" && caller.label === "anonymous")
          reachableAnonymous.push(`${handler.name} ${status}`);
        if (outcome === "passed" && caller.label === "member") reachableMember.push(handler.name);
        if (outcome === "passed" && !expected)
          leaks.push(`${caller.label} ${handler.name} -> ${status} ${text.slice(0, 160)}`);
        if (outcome === "rate-limited" || outcome === "error")
          inconclusive.push(`${caller.label} ${handler.name} -> ${status} ${text.slice(0, 160)}`);
        if (caller.label === "anonymous" && handler.kind !== "stream") {
          const aimed = await call(handler.kind, handler.name, {}, caller, DEV_TENANT_ID);
          if (errorCode(aimed.text) !== "tenant_mismatch")
            anonymousForeignTenantNotRejected.push(`${handler.name} -> ${aimed.status}`);
        }
      }
    }
    console.log(
      `AUTHZ-MATRIX ${JSON.stringify({ handlerCount: handlers.length, reachableAnonymous, reachableMember, anonymousForeignTenantNotRejected, inconclusive, leaks }, null, 1)}`,
    );
    expect(anonymousForeignTenantNotRejected).toEqual([]);
    expect(leaks).toEqual([]);
  });

  test("foreign tenant admin and anonymous never see or touch a victim row by id", async () => {
    const raw = asRawClient(handle.stack.db);
    // Read-only lookup (raw client) of the victim's row ids across every tenant-scoped table.
    const tables = (await raw.unsafe(
      `SELECT DISTINCT c.table_name FROM information_schema.columns c
         JOIN information_schema.columns i
           ON i.table_schema = c.table_schema AND i.table_name = c.table_name AND i.column_name = 'id'
        WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'`,
    )) as ReadonlyArray<{ table_name: string }>;
    const snapshotVictimRows = async (): Promise<Map<string, string>> => {
      const snapshot = new Map<string, string>();
      for (const { table_name } of tables) {
        const rows = await raw.unsafe(
          `SELECT to_jsonb(t) AS row FROM "${table_name}" t WHERE "tenant_id"::text = $1 ORDER BY "id"::text`,
          [DEV_TENANT_ID],
        );
        snapshot.set(table_name, JSON.stringify(rows));
      }
      return snapshot;
    };
    const victimIds = new Map<string, string>();
    for (const { table_name } of tables) {
      const rows = (await raw.unsafe(
        `SELECT "id"::text AS id FROM "${table_name}" WHERE "tenant_id"::text = $1`,
        [DEV_TENANT_ID],
      )) as ReadonlyArray<{ id: string }>;
      // Only uuid ids are unguessable references; bigint sequence ids would match any digit.
      for (const row of rows) if (UUID_PATTERN.test(row.id)) victimIds.set(row.id, table_name);
    }
    const before = await snapshotVictimRows();
    expect(victimIds.size).toBeGreaterThan(10);
    const containsVictimId = (text: string): string | undefined => {
      for (const [id, table] of victimIds) if (text.includes(id)) return `${table}/${id}`;
      return undefined;
    };

    // Fresh admin: the matrix above ends the original attacker session through logout.
    const freshAdmin = await attacker.addUser([ROLES.TenantAdmin]);
    const foreign: Caller = { label: "foreign-admin", user: freshAdmin.session };
    const alive = await call("query", "tenant:query:me", {}, foreign);
    expect(alive.status).toBe(200);
    const anonymous: Caller = { label: "anonymous", roles: [ANONYMOUS_ROLE] };
    const leaks: string[] = [];
    const oracles = new Set<string>();
    const rateLimited = new Set<string>();
    const noopSuccess = new Set<string>();
    const randomId = crypto.randomUUID();
    const queries = [...handle.stack.registry.getAllQueryHandlers().keys()];
    const writes = [...handle.stack.registry.getAllWriteHandlers().keys()];

    await forEachConcurrent(queries, PROBE_CONCURRENCY, async (name) => {
      for (const payload of [{}, { tenantId: DEV_TENANT_ID }]) {
        const res = await call("query", name, payload, foreign);
        const hit = res.status < 300 ? containsVictimId(res.text) : undefined;
        if (hit) leaks.push(`foreign query ${name} ${JSON.stringify(payload)} leaks ${hit}`);
      }
      const anon = await call("query", name, {}, anonymous);
      const anonHit = anon.status < 300 ? containsVictimId(anon.text) : undefined;
      if (anonHit) leaks.push(`anonymous query ${name} leaks ${anonHit}`);
    });

    const detailQueries = queries.filter((q) => q.endsWith(":detail"));
    const mutatingWrites = writes.filter((w) => /:(update|delete|restore)$/.test(w));
    await forEachConcurrent([...victimIds], PROBE_CONCURRENCY, async ([id, table]) => {
      for (const name of detailQueries) {
        const real = await call("query", name, { id }, foreign);
        if (real.status < 300 && containsVictimId(real.text))
          leaks.push(`foreign ${name} ${table}/${id} -> ${real.status}`);
        if (real.status === 429) rateLimited.add(name);
        const fake = await call("query", name, { id: randomId }, foreign);
        if (real.status !== fake.status)
          oracles.add(`${name}: victim ${real.status} vs random ${fake.status}`);
      }
      for (const name of mutatingWrites) {
        const real = await call("write", name, { id, version: 1 }, foreign);
        if (real.status === 429) rateLimited.add(name);
        const fake = await call("write", name, { id: randomId, version: 1 }, foreign);
        // A 2xx that a random id also gets is an idempotent no-op; the victim snapshot below
        // catches the case where such a call still changed a victim row.
        if (real.status < 300 && fake.status >= 300)
          leaks.push(`foreign ${name} ${table}/${id} -> ${real.status} ${real.text.slice(0, 120)}`);
        if (real.status < 300 && fake.status < 300) noopSuccess.add(name);
        if (real.status !== fake.status)
          oracles.add(`${name}: victim ${real.status} vs random ${fake.status}`);
      }
    });
    const after = await snapshotVictimRows();
    const changedVictimTables = [...before]
      .filter(([table, rows]) => after.get(table) !== rows)
      .map(([table]) => table);
    console.log(
      `AUTHZ-XTENANT ${JSON.stringify({ victimIds: victimIds.size, tables: new Set(victimIds.values()).size, leaks, oracles: [...oracles], rateLimited: [...rateLimited], noopSuccess: [...noopSuccess], changedVictimTables }, null, 1)}`,
    );
    expect(changedVictimTables).toEqual([]);
    expect(leaks).toEqual([]);
  });

  test("feature httpRoutes: session routes reject anonymous callers", async () => {
    const routes: string[] = [];
    const sessionRouteResults: string[] = [];
    for (const feature of handle.stack.registry.features.values()) {
      for (const route of Object.values(feature.httpRoutes)) {
        routes.push(
          `${route.anonymous ? "anon" : "session"} ${route.method} ${route.path} (${feature.name})`,
        );
        if (route.anonymous) continue;
        const path = route.path.replace(/:[A-Za-z]+/g, crypto.randomUUID());
        const res = await handle.stack.app.request(path, { method: route.method });
        await res.body?.cancel();
        sessionRouteResults.push(`${route.method} ${route.path} -> ${res.status}`);
      }
    }
    console.log(`AUTHZ-ROUTES ${JSON.stringify({ routes, sessionRouteResults }, null, 1)}`);
    for (const line of sessionRouteResults) expect(line).toMatch(/-> 40[13]$/);
  });
});

describe("live signals inside one tenant", () => {
  async function loginCookie(email: string, password: string): Promise<string> {
    const login = await handle.stack.app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    expect(login.status).toBe(200);
    const authCookie = (login.headers.getSetCookie?.() ?? [])
      .map((cookie) => cookie.split(";")[0] ?? "")
      .filter((cookie) => cookie.startsWith("kumiko_auth="))
      .join("; ");
    expect(authCookie).not.toBe("");
    return authCookie;
  }

  async function openSse(cookie: string) {
    const sse = await handle.stack.app.request("/api/sse", { headers: { Cookie: cookie } });
    expect(sse.status).toBe(200);
    const reader = sse.body?.getReader();
    if (!reader) throw new Error("SSE response has no body");
    const decoder = new TextDecoder();
    let received = "";
    const readUntil = async (marker: string): Promise<void> => {
      while (!received.includes(marker)) {
        const { value, done } = await reader.read();
        if (done) throw new Error(`SSE stream ended before ${marker}`);
        received += decoder.decode(value, { stream: true });
      }
    };
    await readUntil("event: ping");
    const frames = () =>
      received
        .split("\n\n")
        .map((block) => {
          const event = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          return event && data ? { event, data } : undefined;
        })
        .filter((frame) => frame !== undefined && frame.event !== "ping");
    return { readUntil, frames, close: () => reader.cancel() };
  }

  // The stream ends the activity with a config-value change: a role that reads config
  // values must receive it, so reaching it proves everything before it was already filtered.
  async function adminActivityEndingInReadableSignal(admin: SessionUser): Promise<void> {
    await handle.stack.http.write("user-data-rights:write:request-export", {}, admin);
    await handle.stack.http.writeOk(
      "tags:write:tag:create",
      { name: `sentinel-${crypto.randomUUID()}` },
      admin,
    );
    await handle.stack.http.writeOk(
      "config:write:set",
      { key: "file-foundation:config:provider", value: "inmemory" },
      admin,
    );
  }

  // GET /api/sse fans every entity event of the tenant out to every member with id and
  // version. A member must not learn ids of rows from entities no query lets it read.
  test("a member's SSE stream carries no row ids of entities its role cannot read", async () => {
    const tenant = await seedTenant(handle.stack, { persist: true, users: 1 });
    const seededMember = tenant.members[0];
    if (!seededMember) throw new Error("seedTenant returned no member");
    const stream = await openSse(await loginCookie(seededMember.email, seededMember.password));

    await adminActivityEndingInReadableSignal(tenant.admin.session);
    await stream.readUntil("event: config-value");
    await stream.close();

    const memberRoles = seededMember.session.roles;
    const readableEntities = new Set<string>();
    for (const [name, def] of handle.stack.registry.getAllQueryHandlers()) {
      const entity = handle.stack.registry.getHandlerEntity(name);
      if (entity && hasAccess({ roles: memberRoles }, def.access)) readableEntities.add(entity);
    }
    const frames = stream.frames();
    const unreadable = frames
      .filter((frame) => frame && !readableEntities.has(frame.event) && frame.data.includes('"id"'))
      .map((frame) => `${frame?.event} ${frame?.data.slice(0, 200)}`);
    console.log(
      `AUTHZ-SSE ${JSON.stringify({ frames, readable: [...readableEntities], unreadable }, null, 1)}`,
    );
    expect(unreadable).toEqual([]);
  });

  test("an admin's SSE stream still carries the signals of entities its role can read", async () => {
    const tenant = await seedTenant(handle.stack, { persist: true, users: 1 });
    const stream = await openSse(await loginCookie(tenant.admin.email, tenant.admin.password));

    await adminActivityEndingInReadableSignal(tenant.admin.session);
    await stream.readUntil("event: config-value");
    await stream.close();

    const events = new Set(stream.frames().map((frame) => frame?.event));
    expect(events.has("tag")).toBe(true);
  });
});
