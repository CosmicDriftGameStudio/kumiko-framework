import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createInMemoryTransport } from "@cosmicdrift/kumiko-bundled-features/channel-email";
import {
  isMailTransportPlugin,
  mailFoundationFeature,
} from "@cosmicdrift/kumiko-bundled-features/mail-foundation";
import {
  clearInbox,
  mailTransportInMemoryFeature,
} from "@cosmicdrift/kumiko-bundled-features/mail-transport-inmemory";
import {
  TenantQueries,
  tenantMembershipsTable,
  tenantTable,
} from "@cosmicdrift/kumiko-bundled-features/tenant";
import { userTable } from "@cosmicdrift/kumiko-bundled-features/user";
import {
  type CreateKumikoServerOptions,
  type KumikoServerHandle,
  runDevApp,
} from "@cosmicdrift/kumiko-dev-server";
import { fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import { type APIRequestContext, request as playwrightRequest } from "@playwright/test";
import * as z from "zod";
import { createHttpApi, loginViaApi } from "../e2e/auth-kit";
import {
  PLAYWRIGHT_DEMO_ENV,
  SEED_ENABLE_ENV,
  SEED_ROUTES,
  SEED_TOKEN_ENV,
  SEED_TOKEN_HEADER,
} from "../e2e/constants";
import { mailCapture } from "../e2e/mail-capture";
import {
  extraSeedResponseSchema,
  inboxResponseSchema,
  seedTenantResponseSchema,
  seedUserResponseSchema,
} from "../e2e/seed-contract";
import {
  createE2eSeedRoutes,
  type E2eExtraSeeder,
  type E2eSeedRoutesOptions,
} from "../e2e/seed-route";
import {
  type ProvideSeedTenantDeps,
  provideSeedTenant,
  type SeedTenantFixture,
} from "../e2e/seeded-tenant-fixture";
import { seedTenant } from "../seed-tenant";
import { NOTE_CREATE, NOTE_LIST, noteFeature } from "./note-feature";

const TOKEN = "seed-route-test-token";
const ENV_KEYS = [
  SEED_ENABLE_ENV,
  SEED_TOKEN_ENV,
  "NODE_ENV",
  "JWT_SECRET",
  "KUMIKO_SECRETS_MASTER_KEY_V1",
  "KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION",
] as const;

const ADMIN = {
  email: "seed-route-admin@example.test",
  password: "seed-route-admin-pw-1234",
  displayName: "Admin",
  memberships: [],
};

let handle: KumikoServerHandle | undefined;
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env["JWT_SECRET"] = PLAYWRIGHT_DEMO_ENV.JWT_SECRET;
  process.env["KUMIKO_SECRETS_MASTER_KEY_V1"] = PLAYWRIGHT_DEMO_ENV.KUMIKO_SECRETS_MASTER_KEY_V1;
  process.env["KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION"] = "1";
  process.env[SEED_ENABLE_ENV] = "1";
  process.env[SEED_TOKEN_ENV] = TOKEN;
});

afterEach(async () => {
  await Promise.all(requestContexts.splice(0).map((context) => context.dispose()));
  await handle?.stop();
  handle = undefined;
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function boot(
  features: readonly FeatureDefinition[] = [noteFeature],
  seedOptions: E2eSeedRoutesOptions = {},
) {
  const extraRoutes: NonNullable<CreateKumikoServerOptions["extraRoutes"]> =
    createE2eSeedRoutes(seedOptions);
  handle = await runDevApp({ features, port: 0, auth: { admin: ADMIN }, extraRoutes });
  return handle;
}

function post(h: KumikoServerHandle, path: string, body: unknown, token: string | null = TOKEN) {
  return h.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token === null ? {} : { [SEED_TOKEN_HEADER]: token }),
      },
      body: JSON.stringify(body),
    }),
  );
}

function login(h: KumikoServerHandle, email: string, password: string) {
  return post(h, "/api/auth/login", { email, password }, null);
}

async function seedTenantVia(h: KumikoServerHandle, body: unknown = {}) {
  const res = await post(h, SEED_ROUTES.seedTenant, body);
  expect(res.status).toBe(200);
  return seedTenantResponseSchema.parse(await res.json());
}

const noteSeedBodySchema = z.strictObject({ titles: z.array(z.string()).min(1) });

const seedNotes: E2eExtraSeeder = async (ctx, tenantId, body) => {
  const { titles } = noteSeedBodySchema.parse(body);
  for (const title of titles) await ctx.write(NOTE_CREATE, { title });
  return { created: titles.length, tenantId };
};

const requestContexts: APIRequestContext[] = [];

async function apiContext(h: KumikoServerHandle): Promise<APIRequestContext> {
  const port = h.server?.port;
  if (port === undefined) throw new Error("runDevApp did not open a socket under Bun");
  const context = await playwrightRequest.newContext({ baseURL: `http://localhost:${port}` });
  requestContexts.push(context);
  return context;
}

describe("seed routes: gates", () => {
  test("without KUMIKO_TEST_SEED=1 every seed route is 404", async () => {
    delete process.env[SEED_ENABLE_ENV];
    const h = await boot();

    expect((await post(h, SEED_ROUTES.seedTenant, {})).status).toBe(404);
    expect((await post(h, SEED_ROUTES.seedUser, {})).status).toBe(404);
    expect((await post(h, SEED_ROUTES.extraSeed, {})).status).toBe(404);
    const inbox = await h.fetch(
      new Request(`http://localhost${SEED_ROUTES.inbox}`, {
        headers: { [SEED_TOKEN_HEADER]: TOKEN },
      }),
    );
    expect(inbox.status).toBe(404);
  });

  test("NODE_ENV=production is 404 even with the enable flag and a valid token", async () => {
    const h = await boot([noteFeature], { extraSeeders: { notes: seedNotes } });
    const seeded = await seedTenantVia(h);
    process.env["NODE_ENV"] = "production";

    expect((await post(h, SEED_ROUTES.seedTenant, {})).status).toBe(404);
    expect(
      (await post(h, SEED_ROUTES.seedUser, { tenantId: seeded.id, roles: ["SystemAdmin"] })).status,
    ).toBe(404);
    expect(
      (await post(h, SEED_ROUTES.extraSeed, { tenantId: seeded.id, seeder: "notes", body: {} }))
        .status,
    ).toBe(404);
    expect(
      await selectMany(h.stack.db, tenantMembershipsTable, { tenantId: seeded.id }),
    ).toHaveLength(1);
  });

  test("missing or wrong token is 401 and creates nothing", async () => {
    const h = await boot([noteFeature], { extraSeeders: { notes: seedNotes } });
    const seeded = await seedTenantVia(h);
    const systemAdminSeed = { tenantId: seeded.id, roles: ["SystemAdmin"] };
    const noteSeed = { tenantId: seeded.id, seeder: "notes", body: { titles: ["x"] } };

    for (const token of [null, "wrong-token", ""]) {
      expect((await post(h, SEED_ROUTES.seedTenant, {}, token)).status).toBe(401);
      expect((await post(h, SEED_ROUTES.seedUser, systemAdminSeed, token)).status).toBe(401);
      expect((await post(h, SEED_ROUTES.extraSeed, noteSeed, token)).status).toBe(401);
    }
    expect(
      await selectMany(h.stack.db, tenantMembershipsTable, { tenantId: seeded.id }),
    ).toHaveLength(1);
  });

  test("a token missing from the server env is a hard refusal, not an open route", async () => {
    const h = await boot();
    delete process.env[SEED_TOKEN_ENV];

    const res = await post(h, SEED_ROUTES.seedTenant, {}, "anything");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: `${SEED_TOKEN_ENV} is not set; refusing to serve seed routes`,
    });
  });
});

describe("POST /__test/seed-tenant", () => {
  test("creates tenant, admin and members as real rows; the credentials log in", async () => {
    const h = await boot();

    const seeded = await seedTenantVia(h, { name: "route gmbh", members: 1 });

    expect(seeded.name).toBe("route gmbh");
    expect(seeded.members).toHaveLength(1);
    expect(await fetchOne(h.stack.db, tenantTable, { id: seeded.id })).toMatchObject({
      key: seeded.key,
      name: "route gmbh",
    });
    for (const [user, roles] of [
      [seeded.admin, ["TenantAdmin"]],
      [seeded.members[0]!, ["Member"]],
    ] as const) {
      expect(await fetchOne(h.stack.db, userTable, { id: user.id })).toMatchObject({
        email: user.email,
        emailVerified: true,
      });
      const membership = await fetchOne<{ roles: string }>(h.stack.db, tenantMembershipsTable, {
        userId: user.id,
        tenantId: seeded.id,
      });
      expect(JSON.parse(membership?.roles ?? "null")).toEqual(roles);

      const loggedIn = await login(h, user.email, user.password);
      expect(loggedIn.status).toBe(200);
      expect(loggedIn.headers.get("set-cookie")).toMatch(/kumiko_auth=/);
    }
    expect((await login(h, seeded.admin.email, "wrong-password")).status).not.toBe(200);
  });

  test("two parallel calls create two independent tenants", async () => {
    const h = await boot();

    const [a, b] = await Promise.all([seedTenantVia(h), seedTenantVia(h)]);

    expect(a.id).not.toBe(b.id);
    expect(a.key).not.toBe(b.key);
    expect(a.admin.email).not.toBe(b.admin.email);
    expect((await login(h, a.admin.email, a.admin.password)).status).toBe(200);
    expect((await login(h, b.admin.email, b.admin.password)).status).toBe(200);
  });

  test("an empty body is valid; oversize input and unknown keys are 400", async () => {
    const h = await boot();

    const empty = await h.fetch(
      new Request(`http://localhost${SEED_ROUTES.seedTenant}`, {
        method: "POST",
        headers: { [SEED_TOKEN_HEADER]: TOKEN },
      }),
    );
    expect(empty.status).toBe(200);
    expect((await post(h, SEED_ROUTES.seedTenant, { members: 11 })).status).toBe(400);
    expect((await post(h, SEED_ROUTES.seedTenant, { name: "x".repeat(101) })).status).toBe(400);
    expect((await post(h, SEED_ROUTES.seedTenant, { admin: "root" })).status).toBe(400);
  });
});

describe("POST /__test/seed-user", () => {
  test("adds a user with the requested role to an existing tenant", async () => {
    const h = await boot();
    const seeded = await seedTenantVia(h);

    const res = await post(h, SEED_ROUTES.seedUser, { tenantId: seeded.id, roles: ["Member"] });
    expect(res.status).toBe(200);
    const user = seedUserResponseSchema.parse(await res.json());

    const membership = await fetchOne<{ roles: string }>(h.stack.db, tenantMembershipsTable, {
      userId: user.id,
      tenantId: seeded.id,
    });
    expect(JSON.parse(membership?.roles ?? "null")).toEqual(["Member"]);
    expect((await login(h, user.email, user.password)).status).toBe(200);
  });

  test("reserved or unknown roles are 400 and write nothing", async () => {
    const h = await boot();
    const seeded = await seedTenantVia(h);

    for (const roles of [["system"], ["systemadmin"], ["Reviewer"], []]) {
      const res = await post(h, SEED_ROUTES.seedUser, { tenantId: seeded.id, roles });
      expect(res.status).toBe(400);
    }
    expect(
      (await post(h, SEED_ROUTES.seedUser, { tenantId: "not-a-uuid", roles: ["Member"] })).status,
    ).toBe(400);
    expect(
      await selectMany(h.stack.db, tenantMembershipsTable, { tenantId: seeded.id }),
    ).toHaveLength(1);
  });
});

const tenantListSchema = z.object({ rows: z.array(z.object({ id: z.string() })) });

describe("POST /__test/seed-user with SystemAdmin", () => {
  async function seedUserVia(h: KumikoServerHandle, tenantId: string, roles: readonly string[]) {
    const res = await post(h, SEED_ROUTES.seedUser, { tenantId, roles });
    expect(res.status).toBe(200);
    return seedUserResponseSchema.parse(await res.json());
  }

  async function loggedInApi(h: KumikoServerHandle, email: string, password: string) {
    const context = await apiContext(h);
    await loginViaApi(context, { email, password });
    return createHttpApi(context);
  }

  test("SystemAdmin lands as a global user role, never as a membership role", async () => {
    const h = await boot();
    const seeded = await seedTenantVia(h);

    const systemAdminOnly = await seedUserVia(h, seeded.id, ["SystemAdmin"]);
    const tenantAndSystemAdmin = await seedUserVia(h, seeded.id, ["TenantAdmin", "SystemAdmin"]);

    for (const [user, membershipRoles] of [
      [systemAdminOnly, ["Member"]],
      [tenantAndSystemAdmin, ["TenantAdmin"]],
    ] as const) {
      const row = await fetchOne<{ roles: unknown }>(h.stack.db, userTable, { id: user.id });
      expect(parseRoles(row?.roles)).toEqual(["SystemAdmin"]);
      const membership = await fetchOne<{ roles: string }>(h.stack.db, tenantMembershipsTable, {
        userId: user.id,
        tenantId: seeded.id,
      });
      expect(JSON.parse(membership?.roles ?? "null")).toEqual(membershipRoles);
    }
  });

  test("a seeded SystemAdmin logs in and runs a SystemAdmin-only query a TenantAdmin is denied", async () => {
    const h = await boot();
    const seeded = await seedTenantVia(h);
    const other = await seedTenantVia(h);
    const systemAdmin = await seedUserVia(h, seeded.id, ["SystemAdmin"]);

    const asSystemAdmin = await loggedInApi(h, systemAdmin.email, systemAdmin.password);
    const tenants = tenantListSchema.parse(await asSystemAdmin.queryOk(TenantQueries.list, {}));
    expect(tenants.rows.map((tenant) => tenant.id)).toEqual(
      expect.arrayContaining([seeded.id, other.id]),
    );

    const asTenantAdmin = await loggedInApi(h, seeded.admin.email, seeded.admin.password);
    const denied = await asTenantAdmin.queryErr(TenantQueries.list, {});
    expect(denied.code).toBe("access_denied");
  });
});

describe("POST /__test/seed-user with extraRoles", () => {
  const APP_ROLE = "TenantMember";

  test("seeds a user with an app-defined role next to the built-in ones", async () => {
    const h = await boot([noteFeature], { extraRoles: [APP_ROLE] });
    const seeded = await seedTenantVia(h);

    const res = await post(h, SEED_ROUTES.seedUser, {
      tenantId: seeded.id,
      roles: [APP_ROLE, "Member"],
    });
    expect(res.status).toBe(200);
    const user = seedUserResponseSchema.parse(await res.json());

    const membership = await fetchOne<{ roles: string }>(h.stack.db, tenantMembershipsTable, {
      userId: user.id,
      tenantId: seeded.id,
    });
    expect(JSON.parse(membership?.roles ?? "null")).toEqual([APP_ROLE, "Member"]);
    expect((await login(h, user.email, user.password)).status).toBe(200);
  });

  test("without extraRoles the app role stays a 400", async () => {
    const h = await boot();
    const seeded = await seedTenantVia(h);

    const res = await post(h, SEED_ROUTES.seedUser, { tenantId: seeded.id, roles: [APP_ROLE] });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: expect.stringContaining("not a seedable role; allowed: TenantAdmin, Member"),
    });
  });

  test("roles nobody registered stay 400 even with extraRoles", async () => {
    const h = await boot([noteFeature], { extraRoles: [APP_ROLE] });
    const seeded = await seedTenantVia(h);

    for (const roles of [["systemadmin"], [APP_ROLE, "system"], ["Reviewer"], [""], [7], []]) {
      const res = await post(h, SEED_ROUTES.seedUser, { tenantId: seeded.id, roles });
      expect(res.status).toBe(400);
    }
    expect(
      await selectMany(h.stack.db, tenantMembershipsTable, { tenantId: seeded.id }),
    ).toHaveLength(1);
  });
});

describe("POST /__test/seed with extraSeeders", () => {
  function extraSeed(h: KumikoServerHandle, tenantId: string, seeder: string, body?: unknown) {
    return post(h, SEED_ROUTES.extraSeed, { tenantId, seeder, body });
  }

  async function noteTitlesOf(h: KumikoServerHandle, email: string, password: string) {
    const context = await apiContext(h);
    await loginViaApi(context, { email, password });
    return createHttpApi(context).queryOk<readonly string[]>(NOTE_LIST, {});
  }

  test("a registered seeder writes into the seeded tenant only and returns its result", async () => {
    const h = await boot([noteFeature], { extraSeeders: { notes: seedNotes } });
    const seeded = await seedTenantVia(h);
    const neighbour = await seedTenantVia(h);

    const res = await extraSeed(h, seeded.id, "notes", { titles: ["first", "second"] });

    expect(res.status).toBe(200);
    expect(extraSeedResponseSchema.parse(await res.json())).toEqual({
      result: { created: 2, tenantId: seeded.id },
    });
    expect([...(await noteTitlesOf(h, seeded.admin.email, seeded.admin.password))].sort()).toEqual([
      "first",
      "second",
    ]);
    expect(await noteTitlesOf(h, neighbour.admin.email, neighbour.admin.password)).toEqual([]);
  });

  test("a tenant this server's seed-tenant route did not seed is 403 and gets nothing", async () => {
    const h = await boot([noteFeature], { extraSeeders: { notes: seedNotes } });
    await seedTenantVia(h);
    const inProcess = await seedTenant(h.stack, { persist: true });

    for (const tenantId of [inProcess.id, crypto.randomUUID()]) {
      const res = await extraSeed(h, tenantId, "notes", { titles: ["foreign"] });
      expect(res.status).toBe(403);
    }
    expect(await inProcess.api.queryOk<string[]>(NOTE_LIST, {})).toEqual([]);
  });

  test("unknown seeder names, prototype keys and a route without extraSeeders are 404", async () => {
    const h = await boot([noteFeature], { extraSeeders: { notes: seedNotes } });
    const seeded = await seedTenantVia(h);

    for (const seeder of ["missing", "__proto__", "constructor", "toString"]) {
      const res = await extraSeed(h, seeded.id, seeder, {});
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({
        error: `unknown seeder "${seeder}"; registered: notes`,
      });
    }

    await handle?.stop();
    const withoutSeeders = await boot();
    const tenant = await seedTenantVia(withoutSeeders);
    expect((await extraSeed(withoutSeeders, tenant.id, "notes", {})).status).toBe(404);
  });

  test("a body the seeder rejects is 400, a failing write is 500, a malformed request is 400", async () => {
    const h = await boot([noteFeature], { extraSeeders: { notes: seedNotes } });
    const seeded = await seedTenantVia(h);

    const rejected = await extraSeed(h, seeded.id, "notes", { titles: [] });
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toEqual({ error: expect.stringContaining('seeder "notes"') });

    const failed = await extraSeed(h, seeded.id, "notes", { titles: [""] });
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: expect.stringContaining(NOTE_CREATE) });

    expect((await extraSeed(h, "not-a-uuid", "notes", {})).status).toBe(400);
    expect(
      (await post(h, SEED_ROUTES.extraSeed, { tenantId: seeded.id, seeder: "notes", extra: 1 }))
        .status,
    ).toBe(400);
  });

  test("tenant.seed on the seedTenant fixture reaches the seeder over HTTP", async () => {
    const h = await boot([noteFeature], { extraSeeders: { notes: seedNotes } });
    const request = await apiContext(h);
    const browserRequest = await apiContext(h);
    const baseURL = `http://localhost:${h.server?.port}`;
    let fixture: SeedTenantFixture | undefined;

    await provideSeedTenant(
      {
        request,
        // @cast-boundary engine-bridge — the fixture only reads context.request and playwright.request.newContext
        context: { request: browserRequest } as unknown as ProvideSeedTenantDeps["context"],
        playwright: {
          request: playwrightRequest,
        } as unknown as ProvideSeedTenantDeps["playwright"],
        baseURL,
      },
      async (seedTenantFixture) => {
        fixture = seedTenantFixture;
        const tenant = await seedTenantFixture();
        expect(await tenant.seed("notes", { titles: ["via fixture"] })).toEqual({
          created: 1,
          tenantId: tenant.id,
        });
        expect(await tenant.api.queryOk<string[]>(NOTE_LIST, {})).toEqual(["via fixture"]);
        await expect(tenant.seed("missing")).rejects.toThrow(/404/);
      },
    );
    expect(fixture).toBeDefined();
  });
});

describe("POST /__test/seed-user tenant this route did not seed", () => {
  test("a random tenant id is 403 and creates nothing", async () => {
    const h = await boot();

    const res = await post(h, SEED_ROUTES.seedUser, {
      tenantId: crypto.randomUUID(),
      roles: ["Member"],
    });

    expect(res.status).toBe(403);
  });

  test("a tenant seeded in-process (not via this route's seed-tenant) is also 403", async () => {
    const h = await boot();
    const inProcess = await seedTenant(h.stack, { persist: true });

    const res = await post(h, SEED_ROUTES.seedUser, {
      tenantId: inProcess.id,
      roles: ["Member"],
    });

    expect(res.status).toBe(403);
    expect(
      await selectMany(h.stack.db, tenantMembershipsTable, { tenantId: inProcess.id }),
    ).toHaveLength(1);
  });

  test("after seed-tenant on this route, seed-user for that tenant succeeds", async () => {
    const h = await boot();
    const seeded = await seedTenantVia(h);

    const res = await post(h, SEED_ROUTES.seedUser, { tenantId: seeded.id, roles: ["Member"] });

    expect(res.status).toBe(200);
  });
});

describe("GET /__test/inbox", () => {
  function inbox(h: KumikoServerHandle, tenantId: string | undefined, to: string) {
    const query = new URLSearchParams(tenantId === undefined ? { to } : { tenantId, to });
    return h.fetch(
      new Request(`http://localhost${SEED_ROUTES.inbox}?${query}`, {
        headers: { [SEED_TOKEN_HEADER]: TOKEN },
      }),
    );
  }

  test("returns only the recipient's messages of the tenant's inbox", async () => {
    const h = await boot([mailFoundationFeature, mailTransportInMemoryFeature]);
    const seeded = await seedTenantVia(h);
    const usage = mailTransportInMemoryFeature.extensionUsages.find(
      (candidate) => candidate.entityName === "inmemory",
    );
    if (!usage || !isMailTransportPlugin(usage.options)) throw new Error("plugin not registered");
    const transport = await usage.options.build({}, seeded.id);
    clearInbox(seeded.id);
    await transport.send({ to: "Alice@example.test", subject: "for alice", html: "<p>a</p>" });
    await transport.send({ to: "bob@example.test", subject: "for bob", html: "<p>b</p>" });

    const res = await inbox(h, seeded.id, "alice@example.test");
    expect(res.status).toBe(200);
    const body = inboxResponseSchema.parse(await res.json());
    expect(body.messages.map((message) => message.subject)).toEqual(["for alice"]);

    const otherTenant = await seedTenantVia(h);
    const empty = await inbox(h, otherTenant.id, "alice@example.test");
    expect(await empty.json()).toEqual({ messages: [] });
  });

  test("is 501 when neither the tenant feature nor mailOutbox is available, 400 on a bad query", async () => {
    const h = await boot();
    expect((await inbox(h, crypto.randomUUID(), "a@example.test")).status).toBe(501);
    expect((await inbox(h, undefined, "a@example.test")).status).toBe(501);

    const withMail = await (async () => {
      await h.stop();
      return boot([mailFoundationFeature, mailTransportInMemoryFeature]);
    })();
    expect((await inbox(withMail, "not-a-uuid", "a@example.test")).status).toBe(400);
  });

  test("reads a tenantless mail from mailOutbox by `to`, without a tenantId", async () => {
    const outbox = createInMemoryTransport();
    const h = await boot([noteFeature], { mailOutbox: outbox });
    await outbox.send({ to: "outbox@example.test", subject: "outbox mail", html: "<p>x</p>" });

    const res = await inbox(h, undefined, "outbox@example.test");

    expect(res.status).toBe(200);
    const body = inboxResponseSchema.parse(await res.json());
    expect(body.messages.map((message) => message.subject)).toEqual(["outbox mail"]);
  });

  test("two mails to the same address come back newest first; mailCapture with match still finds the older one", async () => {
    const outbox = createInMemoryTransport();
    const h = await boot([noteFeature], { mailOutbox: outbox });
    await outbox.send({ to: "dup@example.test", subject: "first", html: "<p>1</p>" });
    await outbox.send({ to: "dup@example.test", subject: "second", html: "<p>2</p>" });

    const res = await inbox(h, undefined, "dup@example.test");
    const body = inboxResponseSchema.parse(await res.json());
    expect(body.messages.map((message) => message.subject)).toEqual(["second", "first"]);

    const context = await apiContext(h);
    const older = await mailCapture(context, "dup@example.test", {
      match: (mail) => mail.subject === "first",
    });
    expect(older.subject).toBe("first");
    const newest = await mailCapture(context, "dup@example.test");
    expect(newest.subject).toBe("second");
  });

  test("a tenantless inbox request with mailOutbox mounted still needs a valid token", async () => {
    const outbox = createInMemoryTransport();
    const h = await boot([noteFeature], { mailOutbox: outbox });

    const query = new URLSearchParams({ to: "outbox@example.test" });
    const res = await h.fetch(new Request(`http://localhost${SEED_ROUTES.inbox}?${query}`));

    expect(res.status).toBe(401);
  });
});
