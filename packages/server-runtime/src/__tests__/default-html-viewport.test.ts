// Without interactive-widget=resizes-content a mobile keyboard overlays
// position:fixed bottom bars (wizard Next button) instead of lifting them.
import { describe, expect, test } from "bun:test";
import { DEFAULT_HTML } from "../build-prod-bundle.js";

describe("build-prod-bundle DEFAULT_HTML", () => {
  test("viewport meta keeps fixed bars above the mobile keyboard", () => {
    expect(DEFAULT_HTML).toContain(
      '<meta name="viewport" content="width=device-width,initial-scale=1,interactive-widget=resizes-content" />',
    );
  });
});
