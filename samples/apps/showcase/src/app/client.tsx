// Browser-Entry. Dünn — sammelt nur die ClientFeatureDefinitions aus
// den App-Features und übergibt Shell + clientFeatures an
// createKumikoApp. Custom-Screen-Routing macht das Framework selbst
// via clientFeatures.components.

import { createKumikoApp } from "@kumiko/renderer-web";
import { demosClient } from "../features/demos/web";
import { itemsClient } from "../features/items/web";
import { AppShell } from "./shell";

createKumikoApp({
  shell: AppShell,
  clientFeatures: [itemsClient, demosClient],
});
