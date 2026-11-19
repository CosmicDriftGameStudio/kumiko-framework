import { describe, expect, test } from "bun:test";
import { findKumikoPinErrors } from "../managed-files/pins.ts";

describe("findKumikoPinErrors overrides", () => {
  test("an override of a kumiko package is one error", () => {
    const errors = findKumikoPinErrors({
      overrides: { "@cosmicdrift/kumiko-framework": "0.420.0" },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("#overrides");
  });

  test("a resolution of a gamestudio kumiko package is an error", () => {
    const errors = findKumikoPinErrors({
      resolutions: { "@cosmicdriftgamestudio/kumiko-x": "1.0.0" },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("#resolutions");
  });

  test("overrides of other packages are fine", () => {
    expect(
      findKumikoPinErrors({
        overrides: { undici: "7.0.0" },
        resolutions: { "html-to-text": "10.0.1" },
      }),
    ).toEqual([]);
  });

  test("a package without overrides stays clean", () => {
    expect(
      findKumikoPinErrors({ dependencies: { "@cosmicdrift/kumiko-framework": "0.420.0" } }),
    ).toEqual([]);
  });
});
