// captureScenario: the beforeCapture -> present identities -> screenshot
// order shared by runScreenshots and runMatrix. A silent reorder would produce
// wrong screenshots (e.g. a live clock still visible) without any failure.
//
// Lives outside src/e2e/ on purpose — bunfig.toml excludes **/e2e/**.

import { describe, expect, test } from "bun:test";
import type { Page } from "@playwright/test";
import { captureScenario } from "../e2e/screenshots";

function recordingPage(events: string[], bytes: Buffer = Buffer.from("png")) {
  const screenshots: unknown[] = [];
  const page = {
    evaluate: async () => {
      events.push("present");
    },
    screenshot: async (options: unknown) => {
      events.push("screenshot");
      screenshots.push(options);
      return bytes;
    },
  } as unknown as Page; // @cast-boundary test double, only evaluate/screenshot are used
  return { page, screenshots, bytes };
}

describe("captureScenario", () => {
  test("runs beforeCapture, then identity replacement, then the screenshot", async () => {
    const events: string[] = [];
    const { page } = recordingPage(events);

    await captureScenario(
      page,
      {
        beforeCapture: async () => {
          events.push("beforeCapture");
        },
      },
      [{ from: "a@b.c", to: "x@y.z" }],
      { path: "/tmp/out.png" },
    );

    expect(events).toEqual(["beforeCapture", "present", "screenshot"]);
  });

  test("calls beforeCapture on every capture (once per theme x viewport)", async () => {
    const events: string[] = [];
    const { page } = recordingPage(events);
    const scenario = {
      beforeCapture: async () => {
        events.push("beforeCapture");
      },
    };

    for (let i = 0; i < 3; i++) await captureScenario(page, scenario, [], { path: "/tmp/o.png" });

    expect(events).toEqual(Array(3).fill(["beforeCapture", "screenshot"]).flat());
  });

  test("forwards path/animations and the scenario's fullPage and captureStyle, returns the bytes", async () => {
    const { page, screenshots, bytes } = recordingPage([]);

    const result = await captureScenario(
      page,
      { fullPage: true, captureStyle: ".clock { display: none }" },
      [],
      { path: "/tmp/o.png", animations: "disabled" },
    );

    expect(result).toBe(bytes);
    expect(screenshots).toEqual([
      {
        path: "/tmp/o.png",
        animations: "disabled",
        fullPage: true,
        style: ".clock { display: none }",
      },
    ]);
  });

  test("defaults to a viewport capture without style", async () => {
    const { page, screenshots } = recordingPage([]);
    await captureScenario(page, {}, [], { path: "/tmp/o.png" });
    expect(screenshots).toEqual([{ path: "/tmp/o.png", fullPage: false }]);
  });
});
