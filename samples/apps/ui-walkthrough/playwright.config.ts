// @runtime test
// Playwright-Config für den ui-walkthrough-Durchstich. Startet den
// echten dev-server als webServer-Fixture, genau wie `bun dev` — nur
// auf dem Port aus samples/e2e/e2e-ports.ts, damit keine Dev-Session kollidiert.
//
// Der dev-server macht auf PORT-Env basierend das HTTP-Binding. Die
// setupTestStack-Default ist ephemeral (fresh kumiko_test_<random> DB),
// deshalb braucht's keine DB-Reset-Logik hier.

import { defineAppE2eConfig, PLAYWRIGHT_DEMO_ENV } from "@cosmicdrift/kumiko-testing/e2e";
import { E2E_PORTS } from "../../e2e/e2e-ports";

const PORT = E2E_PORTS["framework/ui-walkthrough"];

export default {
  ...defineAppE2eConfig({
    port: PORT,
    serverEntry: "src/app/server.ts",
    locale: "en-US",
    env: PLAYWRIGHT_DEMO_ENV,
  }),
  // globalSetup spawnt vor allen Tests einen bun-Subprozess der die
  // Registry auswertet und `e2e/.e2e-data.json` schreibt. Der eigent-
  // liche generated.spec.ts-Runner liest nur die JSON — framework-
  // runtime bleibt aus dem Playwright-Worker raus (sonst kollidiert
  // sie mit Playwrights expect). Nicht Teil von AppE2eConfigInput,
  // daher als Zusatzfeld auf dem template-erzeugten Config-Objekt.
  globalSetup: "./e2e/global-setup.ts",
};
