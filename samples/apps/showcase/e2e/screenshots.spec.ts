import {
  applyDefaultTheme,
  DEFAULT_THEMES,
  docsSampleDir,
  runMatrix,
} from "../../../e2e/screenshots";
import { SCENARIOS } from "./scenarios";

runMatrix(SCENARIOS, {
  baseDir: docsSampleDir(import.meta.dirname, "apps/showcase"),
  themes: DEFAULT_THEMES,
  applyTheme: applyDefaultTheme,
  locales: ["en"],
});
