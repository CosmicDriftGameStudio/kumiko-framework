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

describe("assertRendererWebShellPresent (#359 CSS-completeness guard)", () => {
  test("fallback + fehlende Shell-Sentinel-Klasse → wirft mit src/styles.css-Hinweis", () => {
    expect(() => assertRendererWebShellPresent(".some-other{display:flex}", fallback)).toThrow(
      /min-h-screen/,
    );
    expect(() => assertRendererWebShellPresent(".some-other{display:flex}", fallback)).toThrow(
      /src\/styles\.css/,
    );
  });

  test("fallback + Shell-Sentinel vorhanden → kein Throw", () => {
    expect(() =>
      assertRendererWebShellPresent(".min-h-screen{min-height:100vh}", fallback),
    ).not.toThrow();
  });

  test("app-eigenes styles.css (kein Fallback) → nie asserten, auch ohne Sentinel", () => {
    expect(() => assertRendererWebShellPresent("", appOwned)).not.toThrow();
  });
});
