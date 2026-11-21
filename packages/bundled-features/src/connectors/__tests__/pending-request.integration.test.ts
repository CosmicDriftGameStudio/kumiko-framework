import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { CONNECTOR_CLIENT_ID, ConnectorHandlers, ConnectorQueries } from "../constants.ts";
import {
  approve,
  plainUser,
  START_PATH,
  setupConnectorsStack,
  startPairing,
  teardownConnectorsStack,
  tenantAdmin,
} from "./connectors-stack.ts";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupConnectorsStack();
});
afterAll(() => teardownConnectorsStack(stack));

type PendingRequest = {
  userCode: string;
  requestedAt: string;
  requestIp: string;
  expiresAt: string;
};

function pendingRequest(userCode: string, user = tenantAdmin) {
  return stack.http.query(ConnectorQueries.pendingRequest, { userCode }, user);
}

async function errorOf(
  res: Response,
): Promise<{ status: number; code: unknown; message: unknown }> {
  const body: { error?: { code?: unknown; message?: unknown } } = await res.json();
  return { status: res.status, code: body.error?.code, message: body.error?.message };
}

describe("connectors pending-request query", () => {
  test("a pending code shows when and from where it was requested", async () => {
    const started = await startPairing(stack);
    const body = await stack.http.queryOk<PendingRequest>(
      ConnectorQueries.pendingRequest,
      { userCode: started.user_code.toLowerCase() },
      tenantAdmin,
    );
    expect(body.requestedAt).toStartWith("2026-11-19T10:00:00");
    expect(body.expiresAt).toStartWith("2026-11-19T10:10:00");
    expect(body.requestIp.length).toBeGreaterThan(0);
  });

  test("expired, confirmed and unknown codes all answer the same error", async () => {
    const confirmed = await startPairing(stack);
    await approve(stack, confirmed.user_code);
    const unknown = await pendingRequest("ZZZZ-ZZZZ");
    expect(unknown.ok).toBe(false);
    const unknownBody = await errorOf(unknown);

    for (const code of [confirmed.user_code]) {
      const res = await pendingRequest(code);
      expect(res.ok).toBe(false);
      expect(await errorOf(res)).toEqual(unknownBody);
    }

    const late = await startPairing(stack);
    stack.clock?.advance({ seconds: 601 });
    const expired = await pendingRequest(late.user_code);
    expect(expired.ok).toBe(false);
    expect(await errorOf(expired)).toEqual(unknownBody);
  });

  test("a non-admin is rejected", async () => {
    const started = await startPairing(stack);
    const res = await pendingRequest(started.user_code, plainUser);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(403);
  });
});

describe("connectors check-device write", () => {
  test("an open code passes and is returned normalized; an unknown or confirmed one fails alike", async () => {
    const started = await startPairing(stack);
    const checked = await stack.http.writeOk<{ userCode: string }>(
      ConnectorHandlers.checkDevice,
      { userCode: started.user_code.toLowerCase() },
      tenantAdmin,
    );
    expect(checked.userCode.replaceAll("-", "")).toBe(started.user_code.replaceAll("-", ""));

    await approve(stack, started.user_code);
    const confirmed = await stack.http.write(
      ConnectorHandlers.checkDevice,
      { userCode: started.user_code },
      tenantAdmin,
    );
    const unknown = await stack.http.write(
      ConnectorHandlers.checkDevice,
      { userCode: "ZZZZ-ZZZZ" },
      tenantAdmin,
    );
    expect(confirmed.ok).toBe(false);
    expect(await errorOf(confirmed)).toEqual(await errorOf(unknown));
  });

  test("a non-admin is rejected", async () => {
    const started = await startPairing(stack);
    const res = await stack.http.write(
      ConnectorHandlers.checkDevice,
      { userCode: started.user_code },
      plainUser,
    );
    expect(res.status).toBe(403);
  });
});

describe("connectors pending-request shows where a request came from", () => {
  let proxied: TestStack;
  beforeAll(async () => {
    proxied = await setupConnectorsStack({}, 1);
  });
  afterAll(() => teardownConnectorsStack(proxied));

  async function pendingFrom(ip: string) {
    const res = await proxied.app.request(START_PATH, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": ip },
      body: new URLSearchParams({ client_id: CONNECTOR_CLIENT_ID }).toString(),
    });
    const started = (await res.json()) as { user_code: string };
    return proxied.http.queryOk<{ requestIp?: string; requestIpLocal?: string }>(
      ConnectorQueries.pendingRequest,
      { userCode: started.user_code },
      tenantAdmin,
    );
  }

  test("a loopback request keeps its address and carries the local-address note", async () => {
    expect(await pendingFrom("::1")).toMatchObject({
      requestIp: "::1",
      requestIpLocal: "connectors.pair.request.ipLocal",
    });
    expect(await pendingFrom("127.0.0.1")).toMatchObject({
      requestIp: "127.0.0.1",
      requestIpLocal: "connectors.pair.request.ipLocal",
    });
  });

  test("an address of the rest of ::/64 is not called local", async () => {
    const body = await pendingFrom("::2");
    expect(body.requestIp).toBe("::/64");
    expect(body.requestIpLocal).toBeUndefined();
  });

  test("a public address carries no local-address note", async () => {
    const body = await pendingFrom("203.0.113.7");
    expect(body.requestIp).toBe("203.0.113.7");
    expect(body.requestIpLocal).toBeUndefined();
  });
});
