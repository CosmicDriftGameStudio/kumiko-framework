// @runtime test
// Marketing-Screenshot-Generator.
//
// Reads scenarios from ./scenarios.ts, writes PNGs to
// $SCREENSHOT_DIR/<name>/<locale>/<theme>/<viewport>.png (required, no default).

import { applyDefaultTheme, DEFAULT_THEMES, runMatrix } from "@cosmicdrift/kumiko-testing/e2e";
import { SCENARIOS } from "./scenarios";

runMatrix(SCENARIOS, {
  themes: DEFAULT_THEMES,
  applyTheme: applyDefaultTheme,
  locales: ["en"],
});
