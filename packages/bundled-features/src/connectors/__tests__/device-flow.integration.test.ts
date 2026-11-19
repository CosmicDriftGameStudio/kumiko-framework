import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { CONNECTOR_CLIENT_ID, ConnectorHandlers } from "../constants.ts";
import { hashDeviceSecret } from "../hash.ts";
import { deviceTable } from "../schema/device.ts";
import {
  approve,
  DEVICE_GRANT,
  listConnectors,
  pairDevice,
  plainUser,
  pollToken,
  postForm,
  START_PATH,
  setupConnectorsStack,
  startPairing,
  TOKEN_PATH,
  teardownConnectorsStack,
  tenantAdmin,
} from "./connectors-stack.ts";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupConnectorsStack();
});
afterAll(() => teardownConnectorsStack(stack));

describe("connectors device flow", () => {
  test("a confirmed pairing hands out the token exactly once and stores only its hash", async () => {
    const started = await startPairing(stack);
    expect(started.res.status).toBe(200);
    expect(started.res.headers.get("cache-control")).toBe("no-store");
    expect(started.user_code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(started.expires_in).toBe(600);
    expect(started.interval).toBe(5);

    const pending = await pollToken(stack, started.device_code);
    expect(pending.status).toBe(400);
    expect(await pending.json()).toEqual({ error: "authorization_pending" });

    const { connectorId } = await approve(stack, started.user_code, "Warehouse PC");
    const granted = await pollToken(stack, started.device_code);
    expect(granted.status).toBe(200);
    expect(granted.headers.get("cache-control")).toBe("no-store");
    const body = (await granted.json()) as Record<string, string>;
    expect(Object.keys(body).sort()).toEqual(["access_token", "token_type"]);
    expect(body["token_type"]).toBe("Bearer");
    expect(body["access_token"]?.startsWith("ksat_")).toBe(true);

    const again = await pollToken(stack, started.device_code);
    expect(again.status).toBe(400);
    expect(await again.json()).toEqual({ error: "invalid_grant" });

    const rows = await selectMany<{ tokenHash: string; connectorId: string }>(
      stack.db,
      deviceTable,
      { tokenHash: hashDeviceSecret(body["access_token"] ?? "") },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.connectorId).toBe(connectorId);
    expect(JSON.stringify(rows)).not.toContain(body["access_token"] ?? "unreachable");

    const connectors = await listConnectors(stack);
    expect(connectors.find((c) => c.id === connectorId)).toMatchObject({
      name: "Warehouse PC",
      status: "active",
    });
  });

  test("the user code is accepted as typed: lower case, no dash, I/L/O read as 1/0", async () => {
    const started = await startPairing(stack);
    const typed = started.user_code
      .replace("-", " ")
      .toLowerCase()
      .replaceAll("1", "l")
      .replaceAll("0", "o");
    await approve(stack, typed);
    const granted = await pollToken(stack, started.device_code);
    expect(granted.status).toBe(200);
  });

  test("polling faster than the interval answers slow_down and widens the interval", async () => {
    const started = await startPairing(stack);
    await pollToken(stack, started.device_code);
    const tooFast = await pollToken(stack, started.device_code);
    expect(await tooFast.json()).toEqual({ error: "slow_down" });

    stack.clock?.advance({ seconds: 11 });
    const patient = await pollToken(stack, started.device_code);
    expect(await patient.json()).toEqual({ error: "authorization_pending" });
  });

  test("a code expires after 600 seconds, for the device and for the admin", async () => {
    const started = await startPairing(stack);
    stack.clock?.advance({ seconds: 601 });
    const expired = await pollToken(stack, started.device_code);
    expect(await expired.json()).toEqual({ error: "expired_token" });
    const res = await stack.http.write(
      ConnectorHandlers.approveDevice,
      { userCode: started.user_code, name: "Late" },
      tenantAdmin,
    );
    expect(res.ok).toBe(false);
  });

  test("only a TenantAdmin can confirm, and an unknown code claims nothing", async () => {
    const started = await startPairing(stack);
    const asUser = await stack.http.write(
      ConnectorHandlers.approveDevice,
      { userCode: started.user_code, name: "Intruder" },
      plainUser,
    );
    expect(asUser.ok).toBe(false);
    const unknown = await stack.http.write(
      ConnectorHandlers.approveDevice,
      { userCode: "ZZZZ-ZZZZ", name: "Nobody" },
      tenantAdmin,
    );
    expect(unknown.ok).toBe(false);
    const still = await pollToken(stack, started.device_code);
    expect(await still.json()).toEqual({ error: "authorization_pending" });
    expect((await listConnectors(stack)).some((c) => c.name === "Intruder")).toBe(false);
  });

  test("OAuth client errors: wrong client_id is 401, wrong grant is 400, Basic auth carries the client", async () => {
    const wrongClient = await postForm(stack, START_PATH, { client_id: "someone-else" });
    expect(wrongClient.status).toBe(401);
    expect(await wrongClient.json()).toEqual({ error: "invalid_client" });

    const wrongGrant = await postForm(stack, TOKEN_PATH, {
      grant_type: "password",
      device_code: "x",
      client_id: "kumiko-satellite",
    });
    expect(wrongGrant.status).toBe(400);
    expect(await wrongGrant.json()).toEqual({ error: "unsupported_grant_type" });

    const viaBasic = await stack.app.request(START_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${Buffer.from("kumiko-satellite:").toString("base64")}`,
      },
      body: "",
    });
    expect(viaBasic.status).toBe(200);

    const brokenBasic = await stack.app.request(START_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${Buffer.from("%E0%A4%A:").toString("base64")}`,
      },
      body: "",
    });
    expect(brokenBasic.status).toBe(401);
    expect(await brokenBasic.json()).toEqual({ error: "invalid_client" });
    const garbageBasic = await stack.app.request(START_PATH, {
      method: "POST",
      headers: { authorization: "Basic !!!not-base64!!!" },
      body: "",
    });
    expect(garbageBasic.status).toBe(401);
    expect(await garbageBasic.json()).toEqual({ error: "invalid_client" });

    const unknownCode = await postForm(stack, TOKEN_PATH, {
      grant_type: DEVICE_GRANT,
      device_code: "never-issued",
      client_id: "kumiko-satellite",
    });
    expect(await unknownCode.json()).toEqual({ error: "invalid_grant" });
  });

  test("two pairings yield two independent connectors", async () => {
    const first = await pairDevice(stack, "First");
    const second = await pairDevice(stack, "Second");
    expect(first.token).not.toBe(second.token);
    expect(first.connectorId).not.toBe(second.connectorId);
  });
});

describe("connectors verification URI", () => {
  async function verificationUris(target: TestStack) {
    const res = await postForm(target, START_PATH, { client_id: CONNECTOR_CLIENT_ID });
    return (await res.json()) as { user_code: string; verification_uri: string };
  }

  test("defaults to the pairing screen's URL on the address the satellite reached", async () => {
    const body = await verificationUris(stack);
    const { origin } = new URL(START_PATH, "http://localhost");
    expect(body.verification_uri).toBe(`${origin}/connector-pair`);
    expect(Object.keys(body)).not.toContain("verification_uri_complete");
  });

  test("APP_BASE_URL wins over the request address", async () => {
    const previous = process.env["APP_BASE_URL"];
    process.env["APP_BASE_URL"] = "https://app.example/some/path";
    try {
      const body = await verificationUris(stack);
      expect(body.verification_uri).toBe("https://app.example/connector-pair");
    } finally {
      if (previous === undefined) delete process.env["APP_BASE_URL"];
      else process.env["APP_BASE_URL"] = previous;
    }
  });

  test("the verificationUri option wins over the default", async () => {
    const custom = await setupConnectorsStack({
      verificationUri: "https://app.example/admin/connector-pair",
    });
    try {
      const body = await verificationUris(custom);
      expect(body.verification_uri).toBe("https://app.example/admin/connector-pair");
    } finally {
      await teardownConnectorsStack(custom);
    }
  });
});
