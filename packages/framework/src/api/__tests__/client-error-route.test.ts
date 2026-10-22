import { describe, expect, test } from "bun:test";
import { createClientErrorRoute } from "../client-error-route.ts";
import { createClientIpResolver } from "../client-ip.ts";

function setup(now: () => number) {
  const app = createClientErrorRoute({
    resolver: undefined,
    clientIpResolver: createClientIpResolver(1, "client-error-route.test"),
    identifySession: async () => {},
    now,
  });
  return (ip: string) =>
    app.request("/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({
        errorId: crypto.randomUUID(),
        kind: "render",
        message: "boom",
      }),
    });
}

describe("client error route without Redis", () => {
  test("limits to 10 reports per minute per IP and recovers after the window", async () => {
    let nowMs = 1_000_000;
    const post = setup(() => nowMs);

    for (let i = 0; i < 10; i++) expect((await post("10.0.0.1")).status).toBe(204);
    const blocked = await post("10.0.0.1");

    expect(blocked.status).toBe(429);
    expect(await blocked.text()).toContain("rate_limit");
    expect((await post("10.0.0.2")).status).toBe(204);

    nowMs += 60_000;
    expect((await post("10.0.0.1")).status).toBe(204);
  });

  test("a flood of fresh IPs does not reset the window of an actively limited IP", async () => {
    const post = setup(() => 1_000_000);

    for (let i = 0; i < 10; i++) await post("10.0.0.1");
    expect((await post("10.0.0.1")).status).toBe(429);

    for (let i = 0; i < 10_050; i++) {
      await post(`172.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`);
      if (i % 500 === 0) await post("10.0.0.1");
    }

    expect((await post("10.0.0.1")).status).toBe(429);
  });
});

describe("client error route with a failing shared limiter", () => {
  test("still limits to 10 reports per minute per IP when the resolver throws", async () => {
    const unreachable = async (): Promise<never> => {
      throw new Error("redis unreachable");
    };
    const app = createClientErrorRoute({
      resolver: {
        check: unreachable,
        enforce: unreachable,
        enforceAll: unreachable,
        peek: unreachable,
      },
      clientIpResolver: createClientIpResolver(1, "client-error-route.test"),
      identifySession: async () => {},
      now: () => 1_000_000,
    });
    const post = () =>
      app.request("/client-errors", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "10.0.0.9" },
        body: JSON.stringify({ errorId: crypto.randomUUID(), kind: "render", message: "boom" }),
      });

    for (let i = 0; i < 10; i++) expect((await post()).status).toBe(204);

    expect((await post()).status).toBe(429);
  });
});
