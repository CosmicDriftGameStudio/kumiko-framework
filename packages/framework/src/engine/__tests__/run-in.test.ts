import { describe, expect, test } from "bun:test";
import { runsInLane } from "../run-in";

describe("runsInLane", () => {
  test("undefined runIn defaults to worker", () => {
    expect(runsInLane(undefined, "worker")).toBe(true);
    expect(runsInLane(undefined, "api")).toBe(false);
    // All-in-one accepts everything, defaults included.
    expect(runsInLane(undefined, "both")).toBe(true);
  });

  test("runIn='both' runs on any single-lane process", () => {
    expect(runsInLane("both", "api")).toBe(true);
    expect(runsInLane("both", "worker")).toBe(true);
    expect(runsInLane("both", "both")).toBe(true);
  });

  test("runIn='api' runs only on api (or all-in-one)", () => {
    expect(runsInLane("api", "api")).toBe(true);
    expect(runsInLane("api", "worker")).toBe(false);
    expect(runsInLane("api", "both")).toBe(true);
  });

  test("runIn='worker' runs only on worker (or all-in-one)", () => {
    expect(runsInLane("worker", "worker")).toBe(true);
    expect(runsInLane("worker", "api")).toBe(false);
    expect(runsInLane("worker", "both")).toBe(true);
  });

  test("processLane='both' disables filtering entirely", () => {
    // All-in-one must run every consumer regardless of pin — it's the
    // single process filling every role.
    expect(runsInLane(undefined, "both")).toBe(true);
    expect(runsInLane("api", "both")).toBe(true);
    expect(runsInLane("worker", "both")).toBe(true);
    expect(runsInLane("both", "both")).toBe(true);
  });
});
