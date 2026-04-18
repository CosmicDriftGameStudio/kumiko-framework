// Full-stack proof for the lifecycle ↔ buildServer wiring:
//
//   1. /health/ready reflects the live lifecycle state (200 → 503 once drained)
//   2. buildServer registers eventDispatcher.stop() as a shutdown hook so
//      the caller never has to remember it
//   3. LIFO order: a hook the caller registered BEFORE buildServer drains
//      AFTER the auto-registered dispatcher hook
//
// We drive drain() directly — no real SIGTERM here. Signal plumbing has its
// own unit test; mixing it with a live server only adds flakiness.

import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
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
let dispatcherStopSpy: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  lifecycle = createLifecycle({ startReady: true });
  hookOrder = [];

  // Register BEFORE setupTestStack so buildServer's hook lands on top in
  // registration order. LIFO drain should then hit buildServer's hook first
  // and ours second — the assertion below keys on that ordering.
  lifecycle.registerShutdownHook("probe-before-boot", async () => {
    hookOrder.push("probe-before-boot");
  });

  stack = await setupTestStack({ features: [widgetFeature], lifecycle });

  // Sanity: stack wiring actually echoed the lifecycle back, and the
  // dispatcher was built (required for the LIFO assertion below).
  if (!stack.lifecycle) throw new Error("lifecycle not wired through setupTestStack");
  if (!stack.eventDispatcher) throw new Error("eventDispatcher not built — MSP missing?");

  // Spy on stop() AFTER buildServer ran. The shutdown-hook captured a bound
  // reference to stop at registration time, but vi.spyOn swaps the prototype
  // method — meaning the drain call goes through the spy.
  dispatcherStopSpy = vi.spyOn(stack.eventDispatcher, "stop");
});

afterEach(() => {
  hookOrder.length = 0;
});

afterAll(async () => {
  // stack.cleanup is idempotent — if a test called it already, this is a no-op
  // safety net for runs where a filter skipped the cleanup test.
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
  test("drain() stops the dispatcher, flips /health/ready, and runs hooks LIFO", async () => {
    // Second probe registered AFTER setupTestStack — landing last in
    // registration order means LIFO drain runs it first.
    lifecycle.registerShutdownHook("probe-after-boot", async () => {
      hookOrder.push("probe-after-boot");
    });

    await lifecycle.drain({ timeoutMs: 2_000 });

    expect(lifecycle.state()).toBe("stopped");

    // The load-bearing assertion: buildServer actually wired the dispatcher
    // into the lifecycle. Without this, a future refactor could drop the
    // registerShutdownHook call and the test would still pass on LIFO alone.
    expect(dispatcherStopSpy).toHaveBeenCalledTimes(1);

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
