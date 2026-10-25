// @runtime dev
//
// Dev server for the showcase. NO auth — the showcase is a UI
// primitive playground, login friction is counterproductive here. Auto-
// mint JWT mode active (TestUsers.admin) → straight into the edit screen.
// To test auth paths: ui-walkthrough or workspaces.

import { runDevApp } from "@cosmicdrift/kumiko-dev-server";
import { localeDe } from "@cosmicdrift/kumiko-locale-de";
import { demosFeature } from "../features/demos";
import { itemsFeature } from "../features/items";
import { publicScreenshotsRoute } from "./mount-public-screenshots";
import { seedShowcaseItems } from "./seed-items";

await runDevApp({
  features: [localeDe(), itemsFeature, demosFeature],
  // PORT env overridable — consistent with publicstatus / ui-walkthrough.
  port: Number.parseInt(process.env["PORT"] ?? "4175", 10),
  clientEntry: "./src/app/client.tsx",
  htmlPath: "./public/index.html",
  extraRoutes: [publicScreenshotsRoute],
  // Watch-Paths inklusive Glob: ein Edit in einem beliebigen Workspace-
  // Package triggert Hot-Reload. Glob expanded zur Boot-Zeit zu allen
  // existierenden packages/*/src — bei neuen Packages muss man nichts
  // anpassen.
  watchDirs: ["./src", "../../../packages/*/src"],
  // ~200 items so the pager (pageSize 50) has something to page through.
  // Idempotent — re-running the dev server does not seed twice.
  seeds: [seedShowcaseItems],
});
