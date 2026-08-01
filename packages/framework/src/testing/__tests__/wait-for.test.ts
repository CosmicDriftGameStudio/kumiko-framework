import { describe, expect, test } from "bun:test";
import { waitFor } from "../wait-for";

describe("waitFor", () => {
  test("calls fn exactly once when it passes on the first attempt (no prior sleep)", async () => {
    let calls = 0;
    const started = Date.now();
    await waitFor(
      () => {
        calls++;
      },
      { delays: [2000] },
    );
    expect(calls).toBe(1);
    // try-first: must not burn the first delay when the condition already holds
    expect(Date.now() - started).toBeLessThan(500);
  });

  test("retries on failure and succeeds once fn passes", async () => {
    let calls = 0;
    await waitFor(
      () => {
        calls++;
        if (calls < 3) throw new Error(`not yet (${calls})`);
      },
      { delays: [1, 1, 1] },
    );
    expect(calls).toBe(3);
  });

  test("throws the last error once every attempt in the schedule fails", async () => {
    let calls = 0;
    await expect(
      waitFor(
        () => {
          calls++;
          throw new Error(`fail-${calls}`);
        },
        { delays: [1, 1] },
      ),
    ).rejects.toThrow("fail-3");
    // N delays → N+1 attempts (final try after the last backoff)
    expect(calls).toBe(3);
  });

  test("throws a descriptive error for an empty delay schedule", async () => {
    await expect(waitFor(() => {}, { delays: [] })).rejects.toThrow(
      "waitFor: empty delay schedule",
    );
  });

  test("supports an async fn", async () => {
    let calls = 0;
    await waitFor(
      async () => {
        calls++;
        if (calls < 2) throw new Error("not yet");
      },
      { delays: [1, 1] },
    );
    expect(calls).toBe(2);
  });
});
