// Browser-Entry für Marketing-Demo. Zwei Features (assets, helpdesk),
// shared shell, alles aus dem Framework-Default.

import { createKumikoApp } from "@kumiko/renderer-web";
import { assetsClient } from "../features/assets/web";
import { helpdeskClient } from "../features/helpdesk/web";
import { AppShell } from "./shell";

createKumikoApp({
  shell: AppShell,
  clientFeatures: [assetsClient, helpdeskClient],
});
