// @runtime test
// Marketing-Screenshot-Generator.
//
// Liest Szenarien aus ./scenarios.ts → schreibt PNGs nach $SCREENSHOT_DIR
// (Pflicht, kein Default).

import { runScreenshots } from "@cosmicdrift/kumiko-testing/e2e";
import { SCENARIOS } from "./scenarios";

runScreenshots(SCENARIOS, { pinLocale: true });
