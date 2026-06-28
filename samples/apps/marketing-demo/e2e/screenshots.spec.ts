// Marketing-Screenshot-Generator für kumiko.rocks.
//
// Liest Szenarien aus ./scenarios.ts → schreibt PNGs cross-repo nach
// `kumiko-platform/apps/marketing/public/screenshots/`. Override via
// SCREENSHOT_DIR-Env wenn die Repos nicht beide in /Users/marc/code/
// liegen.

import { resolve } from "node:path";
import { runScreenshots } from "../../../e2e/screenshots";
import { SCENARIOS } from "./scenarios";

const SCREENSHOT_DIR =
  process.env["SCREENSHOT_DIR"] ??
  resolve(import.meta.dirname, "../../../../../kumiko-platform/apps/marketing/public/screenshots");

runScreenshots(SCENARIOS, { outDir: SCREENSHOT_DIR, pinLocale: true });
