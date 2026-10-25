// @runtime test
// Matrix runner: shoots every scenario across locale × theme × viewport in ONE
// run to <dir>/<name>/<locale>/<theme>/<viewport>.png. The axes can be narrowed via env
// (default = all): SCREENSHOT_LOCALES, SCREENSHOT_THEMES,
// SCREENSHOT_VIEWPORTS, SCREENSHOT_ONLY=<name>. The naming scheme serves the
// preview switcher 1:1. The 3 themes (incl. brand token injection) are
// styleguide-specific and live in ./themes; the generic loop lives in the lib.

import { runMatrix } from "@cosmicdrift/kumiko-testing/e2e";
import { SCENARIOS } from "./scenarios";
import { applyTheme, THEMES } from "./themes";

runMatrix(SCENARIOS, {
  themes: THEMES,
  applyTheme,
  locales: ["en"],
});
