// @runtime test
// Matrix-Runner: schießt jedes Szenario über Locale × Theme × Viewport in EINEM
// Lauf nach <dir>/<name>/<locale>/<theme>/<viewport>.png. Die Achsen sind per Env
// einengbar (Default = alle): SCREENSHOT_LOCALES, SCREENSHOT_THEMES,
// SCREENSHOT_VIEWPORTS, SCREENSHOT_ONLY=<name>. Das Naming-Schema bedient den
// Preview-Switcher 1:1. Die 3 Themes (inkl. Brand-Token-Injektion) sind
// styleguide-spezifisch und leben in ./themes; der generische Loop in der lib.

import { runMatrix } from "@cosmicdrift/kumiko-testing/e2e";
import { SCENARIOS } from "./scenarios";
import { applyTheme, THEMES } from "./themes";

runMatrix(SCENARIOS, {
  themes: THEMES,
  applyTheme,
  locales: ["en"],
});
