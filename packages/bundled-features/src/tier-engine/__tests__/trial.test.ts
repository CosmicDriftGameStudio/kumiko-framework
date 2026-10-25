// Trial-Fenster: reine epochMs-Arithmetik, Rand inklusive.

import { describe, expect, test } from "bun:test";
import { isTrialActive } from "../trial.ts";

const HOUR_MS = 3_600_000;
const start = 1_700_000_000_000;

describe("isTrialActive", () => {
  test("within the window → active", () => {
    expect(isTrialActive(start, start + 10 * 24 * HOUR_MS, 720)).toBe(true);
    expect(isTrialActive(start, start, 720)).toBe(true);
  });

  test("exactly at the end of the window → no longer active (half-open)", () => {
    expect(isTrialActive(start, start + 720 * HOUR_MS, 720)).toBe(false);
  });

  test("after the window → inactive", () => {
    expect(isTrialActive(start, start + 721 * HOUR_MS, 720)).toBe(false);
    expect(isTrialActive(start, start + 31 * 24 * HOUR_MS, 720)).toBe(false);
  });

  test("Dauer 0 → nie aktiv", () => {
    expect(isTrialActive(start, start, 0)).toBe(false);
  });
});
