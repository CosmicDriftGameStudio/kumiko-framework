// Unit test for the CSS completeness guard: after the Tailwind one-shot,
// the build checks whether the output CSS contains the renderer-web shell
// sentinel class—but only when it fell back to the packaged
// renderer-web-styles.css. If it is missing there, production would render
// unstyled and fail with a hint pointing to src/styles.css.

import { describe, expect, test } from "bun:test";
import { assertRendererWebShellPresent } from "../build-prod-bundle.ts";

const fallback = {
  path: "/app/node_modules/renderer-web/src/styles.css",
  isRendererWebFallback: true,
};
const appOwned = { path: "/app/src/styles.css", isRendererWebFallback: false };

describe("assertRendererWebShellPresent", () => {
  test("fallback + missing Shell sentinel class → throws with src/styles.css hint", () => {
    expect(() => assertRendererWebShellPresent(".some-other{display:flex}", fallback)).toThrow(
      /min-h-screen/,
    );
    expect(() => assertRendererWebShellPresent(".some-other{display:flex}", fallback)).toThrow(
      /src\/styles\.css/,
    );
  });

  test("fallback + Shell sentinel present → does not throw", () => {
    expect(() =>
      assertRendererWebShellPresent(".min-h-screen{min-height:100vh}", fallback),
    ).not.toThrow();
  });

  test("app-owned styles.css (no fallback) → never asserts, even without sentinel", () => {
    expect(() => assertRendererWebShellPresent("", appOwned)).not.toThrow();
  });
});
