import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { createLogger, setProcessLogger } from "../../logging/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";

let stack: TestStack;
let logLines: Record<string, unknown>[];
let nextIp = 0;

beforeAll(async () => {
  stack = await setupTestStack({ features: [], trustedProxyHops: 1 });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await stack.redis.flushNamespace();
  logLines = [];
  setProcessLogger(
    createLogger({
      destination: {
        write(chunk: string) {
          logLines.push(JSON.parse(chunk));
        },
      },
    }),
  );
});

afterEach(() => setProcessLogger(null));

function uniqueIp(): string {
  nextIp += 1;
  return `10.20.${Math.floor(nextIp / 250)}.${(nextIp % 250) + 1}`;
}

function validReport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    errorId: crypto.randomUUID(),
    kind: "render",
    message: "Cannot read properties of undefined",
    ...overrides,
  };
}

function report(
  body: unknown,
  headers: Record<string, string> = {},
  ip = uniqueIp(),
): Promise<Response> {
  return stack.app.request("/api/client-errors", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function clientErrorLines(): Record<string, unknown>[] {
  return logLines.filter((line) => line["msg"] === "client error");
}

describe("POST /api/client-errors", () => {
  test("accepts an anonymous report with 204, no body, and logs a warn line", async () => {
    const res = await report(validReport({ screen: "orders:screen:list", buildVersion: "1.2.3" }));

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    const [line] = clientErrorLines();
    expect(line).toMatchObject({
      level: 40,
      kind: "render",
      screen: "orders:screen:list",
      buildVersion: "1.2.3",
      component: "client-errors",
    });
    expect(line).not.toHaveProperty("userId");
  });

  test("a session attributes the report to tenant and user", async () => {
    const token = await stack.jwt.sign(TestUsers.admin);

    const res = await report(validReport(), { Authorization: `Bearer ${token}` });

    expect(res.status).toBe(204);
    expect(clientErrorLines()[0]).toMatchObject({
      tenantId: TestUsers.admin.tenantId,
      userId: TestUsers.admin.id,
    });
  });

  test("an invalid session token does not block the report", async () => {
    const res = await report(validReport(), { Authorization: "Bearer not-a-jwt" });

    expect(res.status).toBe(204);
    expect(clientErrorLines()[0]).not.toHaveProperty("userId");
  });

  test("strips query and fragment from the path", async () => {
    await report(validReport({ path: "/invoices/42?token=abc123&mail=x@y.de#section" }));

    const line = clientErrorLines()[0];
    expect(line?.["path"]).toBe("/invoices/42");
    expect(JSON.stringify(line)).not.toContain("abc123");
  });

  test("scrubs email addresses from message and stack", async () => {
    await report(
      validReport({
        message: "failed for anna.meier@example.com",
        stack: "Error: anna.meier@example.com\n  at render",
      }),
    );

    const serialized = JSON.stringify(clientErrorLines()[0]);
    expect(serialized).not.toContain("anna.meier@example.com");
    expect(serialized).toContain("a***@example.com");
  });

  test.each([
    ["unknown key", validReport({ extra: "x" })],
    ["bad kind", validReport({ kind: "other" })],
    ["errorId not a uuid", validReport({ errorId: "nope" })],
    ["message too long", validReport({ message: "m".repeat(501) })],
    ["stack too long", validReport({ stack: "s".repeat(4001) })],
    ["path too long", validReport({ path: "/".repeat(301) })],
    ["buildVersion with unsafe characters", validReport({ buildVersion: "1.0 <script>" })],
  ])("rejects %s with 400 and does not echo the input", async (_name, body) => {
    const res = await report(body);

    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).not.toContain("nope");
    expect(text).not.toContain("mmmm");
    expect(clientErrorLines()).toHaveLength(0);
  });

  test("rejects malformed JSON with 400", async () => {
    expect((await report("{not json")).status).toBe(400);
  });

  test("rejects a body over 8 KB with 413 and logs nothing", async () => {
    const res = await report(validReport({ stack: "x".repeat(9000) }));

    expect(res.status).toBe(413);
    expect(clientErrorLines()).toHaveLength(0);
  });

  test("limits reports to 10 per minute per IP", async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 10; i++) {
      expect((await report(validReport(), {}, ip)).status).toBe(204);
    }

    const blocked = await report(validReport(), {}, ip);

    expect(blocked.status).toBe(429);
    expect((await report(validReport(), {}, uniqueIp())).status).toBe(204);
  });
});
