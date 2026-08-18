// Browser-Entry für Marketing-Demo. Zwei Features (assets, helpdesk),
// shared shell, alles aus dem Framework-Default.

import { localeDeClient } from "@cosmicdrift/kumiko-locale-de/web";
import { createKumikoApp } from "@cosmicdrift/kumiko-renderer-web";
import { assetsClient } from "../features/assets/web";
import { helpdeskClient } from "../features/helpdesk/web";
import { AppShell } from "./shell";

createKumikoApp({
  shell: AppShell,
  clientFeatures: [localeDeClient(), assetsClient, helpdeskClient],
});
