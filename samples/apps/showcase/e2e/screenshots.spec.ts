// @runtime test
import { applyDefaultTheme, DEFAULT_THEMES, runMatrix } from "@cosmicdrift/kumiko-testing/e2e";
import { SCENARIOS } from "./scenarios";

runMatrix(SCENARIOS, {
  themes: DEFAULT_THEMES,
  applyTheme: applyDefaultTheme,
  locales: ["en"],
});
