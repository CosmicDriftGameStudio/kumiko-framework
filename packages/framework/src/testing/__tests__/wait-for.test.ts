import { describe, expect, test } from "bun:test";
import { waitFor } from "../wait-for";

describe("waitFor", () => {
  test("returns immediately once fn succeeds on the first attempt", async () => {
    let calls = 0;
    await waitFor(
      () => {
        calls++;
      },
      { delays: [1, 1, 1] },
    );
    expect(calls).toBe(1);
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
    ).rejects.toThrow("fail-2");
    expect(calls).toBe(2);
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
