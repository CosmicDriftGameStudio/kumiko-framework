import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  isMailTransportPlugin,
  mailFoundationFeature,
} from "@cosmicdrift/kumiko-bundled-features/mail-foundation";
import {
  clearInbox,
  mailTransportInMemoryFeature,
} from "@cosmicdrift/kumiko-bundled-features/mail-transport-inmemory";
import { tenantMembershipsTable, tenantTable } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { userTable } from "@cosmicdrift/kumiko-bundled-features/user";
import {
  type CreateKumikoServerOptions,
  type KumikoServerHandle,
  runDevApp,
} from "@cosmicdrift/kumiko-dev-server";
import { fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import {
  PLAYWRIGHT_DEMO_ENV,
  SEED_ENABLE_ENV,
  SEED_ROUTES,
  SEED_TOKEN_ENV,
  SEED_TOKEN_HEADER,
} from "../e2e/constants";
import {
  inboxResponseSchema,
  seedTenantResponseSchema,
  seedUserResponseSchema,
} from "../e2e/seed-contract";
import { createE2eSeedRoutes, type E2eSeedRoutesOptions } from "../e2e/seed-route";
import { noteFeature } from "./note-feature";

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

describe("seed routes: gates", () => {
  test("without KUMIKO_TEST_SEED=1 every seed route is 404", async () => {
    delete process.env[SEED_ENABLE_ENV];
    const h = await boot();

    expect((await post(h, SEED_ROUTES.seedTenant, {})).status).toBe(404);
    expect((await post(h, SEED_ROUTES.seedUser, {})).status).toBe(404);
    const inbox = await h.fetch(
      new Request(`http://localhost${SEED_ROUTES.inbox}`, {
        headers: { [SEED_TOKEN_HEADER]: TOKEN },
      }),
    );
    expect(inbox.status).toBe(404);
  });

  test("NODE_ENV=production is 404 even with the enable flag and a valid token", async () => {
    const h = await boot();
    process.env["NODE_ENV"] = "production";

    expect((await post(h, SEED_ROUTES.seedTenant, {})).status).toBe(404);
  });

  test("missing or wrong token is 401 and creates nothing", async () => {
    const h = await boot();

    expect((await post(h, SEED_ROUTES.seedTenant, {}, null)).status).toBe(401);
    expect((await post(h, SEED_ROUTES.seedTenant, {}, "wrong-token")).status).toBe(401);
    expect((await post(h, SEED_ROUTES.seedTenant, {}, "")).status).toBe(401);
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

  test("privileged or unknown roles are 400 and write nothing", async () => {
    const h = await boot();
    const seeded = await seedTenantVia(h);

    for (const roles of [["SystemAdmin"], ["TenantAdmin", "SystemAdmin"], ["Reviewer"], []]) {
      const res = await post(h, SEED_ROUTES.seedUser, { tenantId: seeded.id, roles });
      expect(res.status).toBe(400);
    }
    expect(
      (await post(h, SEED_ROUTES.seedUser, { tenantId: "not-a-uuid", roles: ["Member"] })).status,
    ).toBe(400);
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

  test("SystemAdmin and roles nobody registered stay 400 even with extraRoles", async () => {
    const h = await boot([noteFeature], { extraRoles: [APP_ROLE] });
    const seeded = await seedTenantVia(h);

    for (const roles of [
      ["SystemAdmin"],
      ["systemadmin"],
      [APP_ROLE, "SystemAdmin"],
      ["Reviewer"],
      [""],
      [7],
      [],
    ]) {
      const res = await post(h, SEED_ROUTES.seedUser, { tenantId: seeded.id, roles });
      expect(res.status).toBe(400);
    }
    expect(
      await selectMany(h.stack.db, tenantMembershipsTable, { tenantId: seeded.id }),
    ).toHaveLength(1);
  });
});

describe("POST /__test/seed-user unknown tenant", () => {
  test("is 404 instead of creating a user for a tenant that does not exist", async () => {
    const h = await boot();

    const res = await post(h, SEED_ROUTES.seedUser, {
      tenantId: crypto.randomUUID(),
      roles: ["Member"],
    });

    expect(res.status).toBe(404);
  });
});

describe("GET /__test/inbox", () => {
  function inbox(h: KumikoServerHandle, tenantId: string, to: string) {
    const query = new URLSearchParams({ tenantId, to });
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

  test("is 501 when the in-memory transport is not mounted, 400 on a bad query", async () => {
    const h = await boot();
    expect((await inbox(h, crypto.randomUUID(), "a@example.test")).status).toBe(501);

    const withMail = await (async () => {
      await h.stop();
      return boot([mailFoundationFeature, mailTransportInMemoryFeature]);
    })();
    expect((await inbox(withMail, "not-a-uuid", "a@example.test")).status).toBe(400);
  });
});
