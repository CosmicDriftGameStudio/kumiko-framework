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
});
