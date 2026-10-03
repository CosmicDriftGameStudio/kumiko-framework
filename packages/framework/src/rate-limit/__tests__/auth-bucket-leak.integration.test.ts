import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { setupTestStack, type TestStack } from "../../stack/index.js";

const LIMIT = 2;
const CLIENT_IP = "2001:db8::7";
const TARGET_EMAIL = "victim@example.com";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [],
    // Without a trusted hop the resolver ignores x-forwarded-for and the
    // middleware would key on the shared "unknown" IP.
    trustedProxyHops: 1,
    rateLimit: {
      auth: {
        path: "/api/auth/*",
        limit: LIMIT,
        windowSeconds: 60,
        extractTarget: async (c) => {
          const parsed: unknown = await c.req.raw.clone().json();
          if (typeof parsed !== "object" || parsed === null || !("email" in parsed)) {
            return undefined;
          }
          return typeof parsed.email === "string" ? parsed.email : undefined;
        },
      },
    },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await stack.redis.flushNamespace();
});

async function postLogin(clientIp = CLIENT_IP, email = TARGET_EMAIL): Promise<Response> {
  return await stack.app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": clientIp },
    body: JSON.stringify({ email, password: "wrong-password" }),
  });
}

describe("L2 429 body does not identify the caller", () => {
  test("bucket is the scope tag only; neither IP nor email appear anywhere", async () => {
    for (let i = 0; i < LIMIT; i++) {
      expect((await postLogin()).status).not.toBe(429);
    }
    const blocked = await postLogin();
    expect(blocked.status).toBe(429);

    const raw = await blocked.text();
    const body = JSON.parse(raw) as { error: { details: { bucket: string } } };
    expect(body.error.details.bucket).toBe("l2");
    expect(raw).not.toContain(TARGET_EMAIL);
    expect(raw).not.toContain("victim");
    expect(raw).not.toContain("2001:db8");

    // The not-contains checks only mean something if both values are part of
    // the raw key: changing either one must land in a fresh bucket.
    expect((await postLogin(CLIENT_IP, "other@example.com")).status).not.toBe(429);
    expect((await postLogin("2001:db8::8", TARGET_EMAIL)).status).not.toBe(429);
  });
});
