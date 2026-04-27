// @runtime dev
//
// Dev-Server für den Showcase. KEIN Auth — der Showcase ist eine UI-
// Primitive-Spielwiese, Login-Reibung ist hier kontraproduktiv. Auto-
// Mint-JWT-Mode aktiv (TestUsers.admin) → direkt im Edit-Screen.
// Wer Auth-Pfade testen will: ui-walkthrough oder workspaces.

import { runDevApp } from "@kumiko/dev-server";
import { demosFeature } from "../features/demos";
import { itemsFeature } from "../features/items";
import { seedShowcaseItems } from "./seed-items";

await runDevApp({
  features: [itemsFeature, demosFeature],
  port: 4175,
  clientEntry: "./src/app/client.tsx",
  htmlPath: "./public/index.html",
  // Watch-Paths inklusive Glob: ein Edit in einem beliebigen Workspace-
  // Package triggert Hot-Reload. Glob expanded zur Boot-Zeit zu allen
  // existierenden packages/*/src — bei neuen Packages muss man nichts
  // anpassen.
  watchDirs: ["./src", "../../../packages/*/src"],
  // ~200 Items damit der Pager (pageSize 50) was zum Blättern hat.
  // Idempotent — re-running den dev-server seedet nicht doppelt.
  seeds: [seedShowcaseItems],
});
