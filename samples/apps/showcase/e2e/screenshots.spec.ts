import { resolve } from "node:path";
import { runScreenshots } from "../../../e2e/screenshots";
import { SCENARIOS } from "./scenarios";

const SCREENSHOT_DIR =
  process.env["SCREENSHOT_DIR"] ??
  resolve(import.meta.dirname, "../screenshots");

runScreenshots(SCENARIOS, { outDir: SCREENSHOT_DIR, pinLocale: true });
