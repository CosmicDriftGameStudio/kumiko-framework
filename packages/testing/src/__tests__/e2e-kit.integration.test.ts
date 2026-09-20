import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type KumikoServerHandle, runDevApp } from "@cosmicdrift/kumiko-dev-server";
import { type APIRequestContext, request as playwrightRequest } from "@playwright/test";
import {
  apiCommand,
  apiQuery,
  apiWrite,
  createHttpApi,
  csrfFetch,
  loginViaApi,
} from "../e2e/auth-kit";
import {
  PLAYWRIGHT_DEMO_ENV,
  SEED_ENABLE_ENV,
  SEED_ROUTES,
  SEED_TOKEN_ENV,
  SEED_TOKEN_HEADER,
} from "../e2e/constants";
import { waitForProjection } from "../e2e/poll";
import { seedTenantResponseSchema } from "../e2e/seed-contract";
import { createE2eSeedRoutes } from "../e2e/seed-route";
import { type SeededTenant, type SeedPart, seedTenant, setupAppTestStack } from "../index";
import { withSession } from "../seed-types";
import { NOTE_CREATE, NOTE_LIST, noteFeature } from "./note-feature";

const TOKEN = "e2e-kit-test-token";
const ADMIN = {
  email: "e2e-kit-admin@example.test",
  password: "e2e-kit-admin-pw-1234",
  displayName: "Admin",
  memberships: [],
};

const savedEnv = {
  jwt: process.env["JWT_SECRET"],
  seed: process.env[SEED_ENABLE_ENV],
  token: process.env[SEED_TOKEN_ENV],
};
let handle: KumikoServerHandle;
let baseURL: string;
const contexts: APIRequestContext[] = [];

function newContext(): Promise<APIRequestContext> {
  return playwrightRequest.newContext({ baseURL }).then((context) => {
    contexts.push(context);
    return context;
  });
}

beforeAll(async () => {
  process.env["JWT_SECRET"] = PLAYWRIGHT_DEMO_ENV.JWT_SECRET;
  process.env[SEED_ENABLE_ENV] = "1";
  process.env[SEED_TOKEN_ENV] = TOKEN;
  handle = await runDevApp({
    features: [noteFeature],
    port: 0,
    auth: { admin: ADMIN },
    extraRoutes: createE2eSeedRoutes(),
  });
  const port = handle.server?.port;
  if (port === undefined) throw new Error("runDevApp did not open a socket under Bun");
  baseURL = `http://localhost:${port}`;
});

afterAll(async () => {
  await Promise.all(contexts.map((context) => context.dispose()));
  await handle.stop();
  for (const [key, value] of [
    ["JWT_SECRET", savedEnv.jwt],
    [SEED_ENABLE_ENV, savedEnv.seed],
    [SEED_TOKEN_ENV, savedEnv.token],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function seedOverHttp(anon: APIRequestContext, part: SeedPart): Promise<SeededTenant> {
  const response = await anon.post(SEED_ROUTES.seedTenant, {
    headers: { [SEED_TOKEN_HEADER]: TOKEN },
    data: { members: 1 },
  });
  const seeded = seedTenantResponseSchema.parse(await response.json());
  const adminContext = await newContext();
  await loginViaApi(adminContext, seeded.admin);
  const api = createHttpApi(adminContext);
  const admin = withSession(seeded.admin, seeded.id, ["TenantAdmin"]);
  const tenant: SeededTenant = {
    id: seeded.id,
    key: seeded.key,
    name: seeded.name,
    admin,
    members: seeded.members.map((member) => withSession(member, seeded.id, ["Member"])),
    addUser: () => Promise.reject(new Error("not needed here")),
    api,
    apiAs: () => api,
  };
  await part({ tenant });
  return tenant;
}

describe("auth kit over real HTTP", () => {
  test("loginViaApi authenticates the context; apiWrite/apiQuery echo the CSRF token", async () => {
    const anon = await newContext();
    const seeded = seedTenantResponseSchema.parse(
      await (
        await anon.post(SEED_ROUTES.seedTenant, {
          headers: { [SEED_TOKEN_HEADER]: TOKEN },
          data: {},
        })
      ).json(),
    );
    const context = await newContext();

    const noCookies = await csrfFetch(context, "/api/query", { type: NOTE_LIST, payload: {} });
    expect(noCookies.status()).toBeGreaterThanOrEqual(401);

    await loginViaApi(context, seeded.admin);
    await apiWrite(context, NOTE_CREATE, { title: "over http" });
    expect(await apiQuery<string[]>(context, NOTE_LIST)).toEqual(["over http"]);
  });

  test("loginViaApi names the account and status when the login is refused", async () => {
    const context = await newContext();

    await expect(
      loginViaApi(context, { email: "nobody@example.test", password: "wrong" }),
    ).rejects.toThrow(/nobody@example\.test.*\/api\/auth\/login/);
  });

  test("createHttpApi.writeErr / queryErr return the typed error with the HTTP status", async () => {
    const context = await newContext();
    const anonymous = createHttpApi(context);

    const denied = await anonymous.writeErr(NOTE_CREATE, { title: "nope" });

    expect(denied.httpStatus).toBeGreaterThanOrEqual(401);
    expect(typeof denied.code).toBe("string");
    await expect(anonymous.writeOk(NOTE_CREATE, { title: "nope" })).rejects.toThrow(
      /Expected write ".*" to succeed/,
    );
  });

  test("apiCommand rejects an unknown command instead of reporting acceptance", async () => {
    const context = await newContext();

    await expect(apiCommand(context, "does-not-exist:command:x", {})).rejects.toThrow(
      /Expected command/,
    );
  });

  test("waitForProjection resolves once the read model catches up", async () => {
    let calls = 0;

    const value = await waitForProjection(
      async () => ++calls,
      (count) => count >= 3,
    );

    expect(value).toBe(3);
  });
});

describe("SeedPart portability", () => {
  const seedNote: SeedPart = async ({ tenant }) => {
    await tenant.api.writeOk(NOTE_CREATE, { title: `note of ${tenant.members.length} members` });
  };

  test("the same part seeds an in-process tenant and a tenant reached over HTTP", async () => {
    const stack = await setupAppTestStack([noteFeature]);
    try {
      const inProcess = await seedTenant(stack, { users: 1, with: [seedNote] });
      const overHttp = await seedOverHttp(await newContext(), seedNote);

      expect(await inProcess.api.queryOk<string[]>(NOTE_LIST, {})).toEqual(["note of 1 members"]);
      expect(await overHttp.api.queryOk<string[]>(NOTE_LIST, {})).toEqual(["note of 1 members"]);
    } finally {
      await stack.cleanup();
    }
  });
});
