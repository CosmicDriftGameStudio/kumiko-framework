// Snapshot loads share one pending-flip buffer, so they must not overlap: with the SELECTs
// held open by hand, the test pins that a second load starts only after the first finished
// and that a flip arriving during it survives the load's older rows.

import { describe, expect, test } from "bun:test";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { createRegistry } from "@cosmicdrift/kumiko-framework/engine";
import { GlobalFeatureToggleRuntime } from "../toggle-runtime.js";

function controllableDb() {
  const settleSelect: Array<() => void> = [];
  // Only .unsafe() is reached by selectMany on a raw client.
  const db = {
    unsafe: () =>
      new Promise<readonly unknown[]>((resolve) => {
        settleSelect.push(() => resolve([]));
      }),
  } as unknown as DbConnection;
  return { db, settleSelect };
}

const letPendingMicrotasksRun = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("GlobalFeatureToggleRuntime snapshot loads", () => {
  test("overlapping refresh() calls run one after the other and keep a flip that lands during the second", async () => {
    const { db, settleSelect } = controllableDb();
    const runtime = new GlobalFeatureToggleRuntime(db, createRegistry([]));

    const first = runtime.refresh();
    const second = runtime.refresh();
    await letPendingMicrotasksRun();
    expect(settleSelect).toHaveLength(1);

    settleSelect[0]?.();
    await first;
    await letPendingMicrotasksRun();
    expect(settleSelect).toHaveLength(2);

    runtime.apply("widget", false);
    settleSelect[1]?.();
    await second;

    expect(runtime.readOverride("widget")).toBe(false);
  });
});
