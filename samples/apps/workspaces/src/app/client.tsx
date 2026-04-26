import { emailPasswordClient } from "@kumiko/bundled-features/auth-email-password/web";
import { createKumikoApp } from "@kumiko/renderer-web";
import { demoClient } from "../features/demo";
import { driverClient } from "../features/demo-driver";
import { AppShell } from "./shell";

createKumikoApp({
  shell: AppShell,
  clientFeatures: [emailPasswordClient(), demoClient, driverClient],
});
