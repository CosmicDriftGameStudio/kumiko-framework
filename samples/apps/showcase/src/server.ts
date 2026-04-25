// Dev-Server für den Showcase. KEIN Auth — der Showcase ist eine UI-
// Primitive-Spielwiese, Login-Reibung ist hier kontraproduktiv. Auto-
// Mint-JWT-Mode aktiv (TestUsers.admin) → direkt im Edit-Screen.
// Wer Auth-Pfade testen will: ui-walkthrough oder workspaces.

import { runDevApp } from "@kumiko/dev-server";
import { showcaseFeature } from "./feature";

await runDevApp({
  features: [showcaseFeature],
  port: 4175,
  clientEntry: "./src/client.tsx",
  htmlPath: "./public/index.html",
  // Extra Watch-Paths zu den Renderer-Packages: ändert sich primitives/
  // index.tsx oder eine select.tsx, triggert Hot-Reload. Sonst müsste
  // bun beim Renderer-Edit komplett neu gestartet werden — Watcher
  // sieht nur was hier explizit steht.
  watchDirs: [
    "./src",
    "../../../packages/renderer-web/src",
    "../../../packages/renderer/src",
    "../../../packages/headless/src",
    "../../../packages/bundled-features/src/auth-email-password/web",
  ],
});
