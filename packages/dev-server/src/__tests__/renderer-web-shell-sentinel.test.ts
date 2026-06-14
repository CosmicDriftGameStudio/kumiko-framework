// Unit-Test für den CSS-Completeness-Guard (#359): nach dem Tailwind-One-Shot
// prüft der Build, ob das Output-CSS die renderer-web-Shell-Sentinel-Klasse
// enthält — aber NUR wenn auf das gepackte renderer-web-styles.css
// zurückgefallen wurde. Fehlt sie dort, würde prod unstyled rendern → laut
// failen mit Hinweis auf src/styles.css.

import { describe, expect, test } from "bun:test";
import { assertRendererWebShellPresent } from "../build-prod-bundle";

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
