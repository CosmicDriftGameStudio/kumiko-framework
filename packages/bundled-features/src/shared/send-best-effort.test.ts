import { describe, expect, test } from "bun:test";
import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { runBestEffort, sendBestEffort } from "./send-best-effort.ts";

function ctxWithLog(warnings: string[]): Pick<HandlerContext, "notify" | "obs"> {
  const obs = { log: { warn: (message: string) => warnings.push(message) } };
  // Partial context: the helpers under test read only obs.log.warn and notify.
  return { obs } as unknown as Pick<HandlerContext, "notify" | "obs">;
}

describe("best-effort helpers", () => {
  test("runBestEffort runs without ctx.notify and swallows failures into a warning", async () => {
    const warnings: string[] = [];
    const ctx = ctxWithLog(warnings);
    let ran = false;
    await runBestEffort(ctx, "ran failed", async () => {
      ran = true;
    });
    expect(ran).toBe(true);
    expect(warnings).toEqual([]);

    await runBestEffort(ctx, "boom failed", async () => {
      throw new Error("boom");
    });
    expect(warnings).toEqual(["boom failed"]);
  });

  test("sendBestEffort without ctx.notify warns and does not call send", async () => {
    const warnings: string[] = [];
    let sent = false;
    await sendBestEffort(ctxWithLog(warnings), "send failed", async () => {
      sent = true;
    });
    expect(sent).toBe(false);
    expect(warnings).toEqual(["send failed"]);
  });
});
