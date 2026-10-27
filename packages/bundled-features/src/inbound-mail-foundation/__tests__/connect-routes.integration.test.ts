// Connect-routes integration — mounts createInboundMailConnectRoutes as
// real extraRoutes on a setupTestStack, driven with
// real HTTP through the framework's own auth/signature wiring, never a
// hand-rolled Hono app or createTestDispatcher.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { inboundCredentialSecretKey, mailAccountsProjectionTable } from "../index.ts";
import {
  adminFor,
  CALLBACK_PATH,
  CALLBACK_URL,
  CONNECT_PATH,
  type ConnectRoutesEnv,
  type ConnectTestUser,
  getCallback as callbackOn,
  callbackQuery,
  getConnect as connectOn,
  connectRouteFeatures,
  connectRoutes,
  createMailAccountTables,
  OAUTH_PROVIDER_KEY,
  setupConnectRoutesStack,
} from "./connect-routes-test-support.ts";

let env: ConnectRoutesEnv;

beforeAll(async () => {
  env = await setupConnectRoutesStack();
});

afterAll(async () => {
  await env.stack.cleanup();
  resetPiiSubjectKmsForTests();
});

const getConnect = (query: string, user?: ConnectTestUser) => connectOn(env.stack, query, user);
const getCallback = (query: string) => callbackOn(env.stack, query);

describe("connect-routes — connect", () => {
  test("401 without session user", async () => {
    const res = await getConnect(
      `provider=${OAUTH_PROVIDER_KEY}&scope=shared&mailbox=inbox@acme.test`,
    );
    expect(res.status).toBe(401);
  });

  test("400 when query params are incomplete", async () => {
    const res = await getConnect(`provider=${OAUTH_PROVIDER_KEY}`, adminFor(4301));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_connect_request");
  });

  test("404 for unknown provider key", async () => {
    const res = await getConnect(
      "provider=does-not-exist&scope=shared&mailbox=inbox@acme.test",
      adminFor(4302),
    );
    expect(res.status).toBe(404);
  });

  test("400 when provider has no oauth flow (inmemory)", async () => {
    const res = await getConnect(
      "provider=inmemory&scope=shared&mailbox=inbox@acme.test",
      adminFor(4303),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("provider_has_no_oauth_flow");
  });

  test("302 redirect to provider authorize URL with signed state", async () => {
    const res = await getConnect(
      `provider=${OAUTH_PROVIDER_KEY}&scope=shared&mailbox=team@acme.test`,
      adminFor(4304),
    );
    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toBeTruthy();
    const url = new URL(location!);
    expect(url.origin + url.pathname).toBe("https://oauth.test/authorize");
    expect(url.searchParams.get("redirect_uri")).toBe(CALLBACK_URL);
    expect(url.searchParams.get("state")).toBeTruthy();
  });
});

describe("connect-routes — oauth callback", () => {
  test("400 when code/state missing", async () => {
    const res = await getCallback("");
    expect(res.status).toBe(400);
  });

  test("400 on tampered state", async () => {
    const res = await getCallback("code=ok&state=not.a.valid.state");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_state");
  });

  test("happy path: creates mail account + stores refresh token secret", async () => {
    const user = adminFor(4305);
    const connectRes = await getConnect(
      `provider=${OAUTH_PROVIDER_KEY}&scope=user&mailbox=owner@acme.test`,
      user,
    );
    const state = new URL(connectRes.headers.get("location")!).searchParams.get("state");
    expect(state).toBeTruthy();

    const callbackRes = await getCallback(callbackQuery("owner@acme.test", state!));
    expect(callbackRes.status).toBe(200);
    const body = (await callbackRes.json()) as { connected: boolean; accountId: string };
    expect(body.connected).toBe(true);
    expect(body.accountId).toBeTruthy();

    const accounts = await selectMany(env.stack.db, mailAccountsProjectionTable, {
      id: body.accountId,
    });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.["provider"]).toBe(OAUTH_PROVIDER_KEY);
    expect(accounts[0]?.["ownerUserId"]).toBe(user.id);

    const stored = await env.secrets.get(user.tenantId, inboundCredentialSecretKey(body.accountId));
    expect(stored).toBeDefined();
    expect(stored!.reveal()).toBe("refresh-token-abc");
  });

  test("409 when the mailbox address is already connected", async () => {
    const user = adminFor(4306);
    const query = `provider=${OAUTH_PROVIDER_KEY}&scope=user&mailbox=twice@acme.test`;
    const stateOf = async () => {
      const res = await getConnect(query, user);
      return new URL(res.headers.get("location")!).searchParams.get("state")!;
    };
    const first = await getCallback(callbackQuery("twice@acme.test", await stateOf()));
    expect(first.status).toBe(200);

    const second = await getCallback(callbackQuery("twice@acme.test", await stateOf()));

    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("address_already_connected");
    expect(body.error.message).toContain("already connected");
  });

  test("502 when token exchange fails", async () => {
    const connectRes = await getConnect(
      `provider=${OAUTH_PROVIDER_KEY}&scope=shared&mailbox=fail@acme.test`,
      adminFor(4306),
    );
    const state = new URL(connectRes.headers.get("location")!).searchParams.get("state");

    const res = await getCallback(`code=fail-exchange&state=${encodeURIComponent(state!)}`);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("token_exchange_failed");
  });

  test("502 when provider omits refresh token", async () => {
    const connectRes = await getConnect(
      `provider=${OAUTH_PROVIDER_KEY}&scope=shared&mailbox=norefresh@acme.test`,
      adminFor(4307),
    );
    const state = new URL(connectRes.headers.get("location")!).searchParams.get("state");

    const res = await getCallback(`code=no-refresh&state=${encodeURIComponent(state!)}`);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("no_refresh_token");
  });
});

describe("connect-routes — oauth callback without a secrets context", () => {
  let bareStack: TestStack;

  beforeAll(async () => {
    bareStack = await setupTestStack({
      features: connectRouteFeatures,
      extraRoutes: connectRoutes(),
    });
    await createMailAccountTables(bareStack.db);
  });

  afterAll(async () => {
    await bareStack.cleanup();
  });

  test("500 secrets_context_missing and no orphan mail account is created", async () => {
    const user = adminFor(4308);
    const token = await bareStack.jwt.sign(user);
    const connectRes = await bareStack.app.request(
      `${CONNECT_PATH}?provider=${OAUTH_PROVIDER_KEY}&scope=shared&mailbox=nosecrets@acme.test`,
      { headers: { Authorization: `Bearer ${token}` }, redirect: "manual" },
    );
    const state = new URL(connectRes.headers.get("location")!).searchParams.get("state");

    const res = await bareStack.app.request(
      `${CALLBACK_PATH}?${callbackQuery("nosecrets@acme.test", state!)}`,
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("secrets_context_missing");

    const accounts = await selectMany(bareStack.db, mailAccountsProjectionTable, {
      tenantId: user.tenantId,
    });
    expect(accounts).toHaveLength(0);
  });
});
