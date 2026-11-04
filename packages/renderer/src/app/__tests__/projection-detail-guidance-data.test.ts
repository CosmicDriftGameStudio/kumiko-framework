import { describe, expect, test } from "bun:test";
import { readSteps } from "../projection-detail-guidance-data.ts";
import { uniqueLabelKeys } from "../unique-label-keys.ts";

describe("readSteps", () => {
  test("a repeated id keeps the first step and drops the later ones", () => {
    const steps = readSteps([
      { id: "a", title: "First" },
      { id: "b", title: "Other" },
      { id: "a", title: "Duplicate" },
    ]);
    expect(steps.map((step) => [step.id, step.title])).toEqual([
      ["a", "First"],
      ["b", "Other"],
    ]);
  });
});

describe("uniqueLabelKeys", () => {
  test("repeated labels get distinct keys", () => {
    const keys = uniqueLabelKeys(["Home", "Orders", "Home"]);
    expect(new Set(keys).size).toBe(3);
  });
});
