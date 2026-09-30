import { describe, expect, test } from "bun:test";
import { validateNoReturnSteps } from "../steps/_no-return-guard.js";
import type { StepInstance } from "../types/step.js";

describe("validateNoReturnSteps", () => {
  test("passes when no return steps present", () => {
    const steps = [{ kind: "noop" }] as unknown as readonly StepInstance[];
    expect(() => validateNoReturnSteps(steps, "r.step.branch.onTrue")).not.toThrow();
  });

  test("throws when return step is nested", () => {
    const steps = [{ kind: "return" }] as unknown as readonly StepInstance[];
    expect(() => validateNoReturnSteps(steps, "r.step.forEach.do")).toThrow(
      /not allowed inside r\.step\.forEach\.do/,
    );
  });
});
