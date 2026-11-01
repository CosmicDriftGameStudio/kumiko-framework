// Browser entry for the marketing demo. Two features (assets, ticketing),
// shared shell, everything from the framework defaults.

import { localeDeClient } from "@cosmicdrift/kumiko-locale-de/web";
import { createKumikoApp } from "@cosmicdrift/kumiko-renderer/web";
import { assetsClient } from "../features/assets/web";
import { ticketingClient } from "../features/ticketing/web";
import { AppShell } from "./shell";

createKumikoApp({
  shell: AppShell,
  clientFeatures: [localeDeClient(), assetsClient, ticketingClient],
});
