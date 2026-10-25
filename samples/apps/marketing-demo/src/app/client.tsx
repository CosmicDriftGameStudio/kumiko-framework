// Browser entry for the marketing demo. Two features (assets, helpdesk),
// shared shell, everything from the framework defaults.

import { localeDeClient } from "@cosmicdrift/kumiko-locale-de/web";
import { createKumikoApp } from "@cosmicdrift/kumiko-renderer/web";
import { assetsClient } from "../features/assets/web";
import { helpdeskClient } from "../features/helpdesk/web";
import { AppShell } from "./shell";

createKumikoApp({
  shell: AppShell,
  clientFeatures: [localeDeClient(), assetsClient, helpdeskClient],
});
