import { emailPasswordClient } from "@cosmicdrift/kumiko-bundled-features/auth-email-password/web";
import { localeDeClient } from "@cosmicdrift/kumiko-locale-de/web";
import { createKumikoApp } from "@cosmicdrift/kumiko-renderer-web";
import { demoClient } from "../features/demo/web";
import { driverClient } from "../features/demo-driver/web";
import { AppShell } from "./shell";

createKumikoApp({
  shell: AppShell,
  clientFeatures: [localeDeClient(), emailPasswordClient(), demoClient, driverClient],
});
