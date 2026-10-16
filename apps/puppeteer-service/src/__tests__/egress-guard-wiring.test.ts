// Chromium-free proof that render.ts registers the SSRF egress interception
// (enterprise#277/2). The full abort-against-local-server path stays in
// render.integration.test.ts (skipped in CI — Chromium won't launch).

import { describe, expect, test } from "bun:test";
import { attachEgressRequestGuard } from "../render";

type FakeRequest = {
  url: () => string;
  abort: (errorCode: string) => Promise<void>;
  continue: () => Promise<void>;
};

describe("attachEgressRequestGuard wiring", () => {
  test("enables interception and aborts blocked URLs / continues allowed ones", async () => {
    let interceptionEnabled = false;
    let requestHandler: ((req: FakeRequest) => void) | undefined;
    const page = {
      async setRequestInterception(value: boolean) {
        interceptionEnabled = value;
      },
      on(event: "request", handler: (req: FakeRequest) => void) {
        expect(event).toBe("request");
        requestHandler = handler;
      },
    };

    await attachEgressRequestGuard(page);
    expect(interceptionEnabled).toBe(true);
    expect(requestHandler).toBeDefined();

    const blockedCalls: string[] = [];
    const allowedCalls: string[] = [];

    requestHandler!({
      url: () => "http://127.0.0.1/tracking-pixel.png",
      abort: async (code) => {
        blockedCalls.push(code);
      },
      continue: async () => {
        allowedCalls.push("continue");
      },
    });
    expect(blockedCalls).toEqual(["blockedbyclient"]);
    expect(allowedCalls).toEqual([]);

    blockedCalls.length = 0;
    requestHandler!({
      url: () => "data:image/png;base64,iVBORw0KGgo=",
      abort: async (code) => {
        blockedCalls.push(code);
      },
      continue: async () => {
        allowedCalls.push("continue");
      },
    });
    expect(blockedCalls).toEqual([]);
    expect(allowedCalls).toEqual(["continue"]);
  });
});
