import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { DemoModePayload } from "@cosmicdrift/kumiko-types/demo-mode-types";
import { renderHook, waitFor } from "@testing-library/react";
import { useDemoMode } from "../use-demo-mode.ts";

let fetchCalls: string[];
let originalFetch: typeof fetch;

function stubFetch(respond: () => Promise<Response>): void {
  globalThis.fetch = (async (url: unknown) => {
    fetchCalls.push(String(url));
    return respond();
  }) as typeof fetch;
}

beforeEach(() => {
  fetchCalls = [];
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const VALID_PAYLOAD: DemoModePayload = {
  readOnly: true,
  notice: {
    text: { en: "Read-only demo" },
    accounts: [{ role: "admin", email: "a@demo.example", password: "pw-1234" }],
  },
};

// The valid-payload test must stay last: only a valid answer is cached module-wide, so it would
// leak into every test after it. Failures are never cached, so tests 1 to 3 are independent.
describe("useDemoMode", () => {
  test("stays null and asks /demo-mode when the route answers 404", async () => {
    stubFetch(async () => new Response(null, { status: 404 }));
    const { result } = renderHook(() => useDemoMode());
    await waitFor(() => expect(fetchCalls).toEqual(["/demo-mode"]));
    expect(result.current).toBeNull();
  });

  test("stays null when the body does not match the schema", async () => {
    stubFetch(async () => Response.json({ readOnly: "yes" }));
    const { result } = renderHook(() => useDemoMode());
    await waitFor(() => expect(fetchCalls).toHaveLength(1));
    expect(result.current).toBeNull();
  });

  test("stays null when fetch throws", async () => {
    stubFetch(async () => {
      throw new Error("offline");
    });
    const { result } = renderHook(() => useDemoMode());
    await waitFor(() => expect(fetchCalls).toHaveLength(1));
    expect(result.current).toBeNull();
  });

  test("shares one fetch across hooks and serves later renders from the cache", async () => {
    stubFetch(async () => Response.json(VALID_PAYLOAD));
    const first = renderHook(() => useDemoMode());
    const second = renderHook(() => useDemoMode());
    await waitFor(() => expect(first.result.current).toEqual(VALID_PAYLOAD));
    await waitFor(() => expect(second.result.current).toEqual(VALID_PAYLOAD));
    expect(fetchCalls).toHaveLength(1);

    const later = renderHook(() => useDemoMode());
    expect(later.result.current).toEqual(VALID_PAYLOAD);
    expect(fetchCalls).toHaveLength(1);
  });
});
