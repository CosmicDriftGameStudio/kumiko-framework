// Full-stack proof for lifecycle ↔ buildServer wiring.
// Drives drain() directly — SIGTERM plumbing has its own unit test.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { defineFeature } from "../../engine";
import { setupTestStack, sharedWidgetEntity, type TestStack } from "../../testing";
import { createLifecycle, type Lifecycle } from "../lifecycle";

const widgetFeature = defineFeature("lifecycle-probe", (r) => {
  r.entity("widget", sharedWidgetEntity);
  // One MSP ensures buildServer actually constructs an eventDispatcher —
  // without a consumer, dispatcher stays undefined and we wouldn't prove
  // the shutdown-hook registration at all.
  r.multiStreamProjection({
    name: "observer",
    apply: {
      "widget.created": async () => {},
    },
  });
});

let stack: TestStack;
let lifecycle: Lifecycle;
let hookOrder: string[];

beforeAll(async () => {
  lifecycle = createLifecycle({ startReady: true });
  hookOrder = [];

  // Register BEFORE setupTestStack so buildServer's hook lands in the middle
  // of registration order — our assertion below keys on that layout.
  lifecycle.registerShutdownHook("probe-before-boot", async () => {
    hookOrder.push("probe-before-boot");
  });

  stack = await setupTestStack({ features: [widgetFeature], lifecycle });

  if (!stack.lifecycle) throw new Error("lifecycle not wired through setupTestStack");
  if (!stack.eventDispatcher) throw new Error("eventDispatcher not built — MSP missing?");
});

afterEach(() => {
  hookOrder.length = 0;
});

afterAll(async () => {
  await stack.cleanup();
});

describe("lifecycle — /health/ready live state", () => {
  test("returns 200 with state=ready before drain", async () => {
    const res = await stack.app.request("/health/ready");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      state: string;
      uptimeSec: number;
    };
    expect(body.status).toBe("ready");
    expect(body.state).toBe("ready");
    expect(body.uptimeSec).toBeGreaterThanOrEqual(0);
  });

  test("/health stays trivial regardless of lifecycle state", async () => {
    const res = await stack.app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("lifecycle — drain wiring", () => {
  test("buildServer registers eventDispatcher between caller hooks", () => {
    // Order matters, not just existence: probe-before-boot was registered
    // before setupTestStack, so buildServer's eventDispatcher hook must land
    // AFTER it in registration order. probe-after-boot is registered in the
    // next test, so it isn't in the list yet.
    expect(lifecycle.hookNames()).toEqual(["probe-before-boot", "eventDispatcher"]);
  });

  test("drain() flips /health/ready to 503 and runs hooks LIFO", async () => {
    // Second probe registered AFTER setupTestStack — landing last in
    // registration order means LIFO drain runs it first.
    lifecycle.registerShutdownHook("probe-after-boot", async () => {
      hookOrder.push("probe-after-boot");
    });

    await lifecycle.drain({ timeoutMs: 2_000 });

    expect(lifecycle.state()).toBe("stopped");

    const res = await stack.app.request("/health/ready");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; state: string };
    expect(body.status).toBe("not_ready");
    expect(body.state).toBe("stopped");

    // LIFO proof: probe-after-boot ran first (last registered), then the
    // dispatcher hook (registered by buildServer in the middle), then
    // probe-before-boot (first registered). The dispatcher hook doesn't
    // push into hookOrder, so we only see our two probes in inverse order.
    expect(hookOrder).toEqual(["probe-after-boot", "probe-before-boot"]);
  });
});
