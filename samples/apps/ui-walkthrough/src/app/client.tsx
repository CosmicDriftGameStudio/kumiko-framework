// Browser-Entry. Sammelt nur die ClientFeatures (auth + tasks) und
// übergibt Shell + clientFeatures an createKumikoApp.

import { emailPasswordClient } from "@cosmicdrift/kumiko-bundled-features/auth-email-password/web";
import { createKumikoApp } from "@cosmicdrift/kumiko-renderer-web";
import { tasksClient } from "../features/tasks/web";
import { AppShell } from "./shell";

createKumikoApp({
  shell: AppShell,
  clientFeatures: [emailPasswordClient(), tasksClient],
});
