import { describe, expect, test } from "bun:test";
import { validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import { ticketFeature } from "../feature";

describe("dashboard-stats recipe", () => {
  test("the screens, including the design options dashboard, pass boot validation", () => {
    expect(() => validateBoot(withBootValidatorFixture([ticketFeature]))).not.toThrow();
  });
});
