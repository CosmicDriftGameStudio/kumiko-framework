import { describe, expect, test } from "bun:test";
import type { TenantId } from "@cosmicdrift/kumiko-types/identifiers";
import type { SseBroker } from "../../api/sse-broker.ts";
import { createUserLiveSignals } from "../user-live-signals.ts";

const TENANT = "00000000-0000-4000-8000-000000000001" as TenantId; // test fixture id

type Pushed = { readonly channel: string; readonly type: string; readonly data: unknown };

function brokerRecording(pushed: Pushed[], failFor?: string): SseBroker {
  return {
    pushToChannel: async (channel: string, event: { type: string; data: unknown }) => {
      const data = event.data as { userId?: string }; // test double: reads back what the signal pushed
      if (failFor !== undefined && data.userId === failFor) throw new Error("broker down");
      pushed.push({ channel, type: event.type, data: event.data });
    },
  } as unknown as SseBroker; // test double: only pushToChannel is used
}

describe("createUserLiveSignals", () => {
  test("pushes one frame per distinct user on the caller's tenant channel", async () => {
    const pushed: Pushed[] = [];
    const signals = createUserLiveSignals(brokerRecording(pushed), TENANT, { warn: () => {} });
    await signals.push(["u1", "u2", "u1"], { type: "x:event:changed", entity: "doc", id: "d1" });
    expect(pushed).toEqual([
      {
        channel: `tenant:${TENANT}`,
        type: "x:event:changed",
        data: { userId: "u1", entity: "doc", id: "d1" },
      },
      {
        channel: `tenant:${TENANT}`,
        type: "x:event:changed",
        data: { userId: "u2", entity: "doc", id: "d1" },
      },
    ]);
  });

  test("a failing push is logged and does not stop the others or throw", async () => {
    const pushed: Pushed[] = [];
    const warnings: string[] = [];
    const signals = createUserLiveSignals(brokerRecording(pushed, "u1"), TENANT, {
      warn: (message: string) => {
        warnings.push(message);
      },
    });
    await signals.push(["u1", "u2"], { type: "x:event:changed" });
    expect(pushed.map((frame) => (frame.data as { userId: string }).userId)).toEqual(["u2"]);
    expect(warnings).toHaveLength(1);
  });
});
