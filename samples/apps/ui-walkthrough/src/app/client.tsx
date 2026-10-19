// Browser-Entry. Sammelt nur die ClientFeatures (auth + tasks) und
// übergibt Shell + clientFeatures an createKumikoApp.

import { emailPasswordClient } from "@cosmicdrift/kumiko-bundled-features/auth-email-password/web";
import { textBlocksClient } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import { documentDesignerClient } from "@cosmicdrift/kumiko-document-designer/web";
import { localeDeClient } from "@cosmicdrift/kumiko-locale-de/web";
import { createKumikoApp } from "@cosmicdrift/kumiko-renderer/web";
import { billingClient } from "../features/billing/web";
import { rentalClient } from "../features/rental/web";
import { tasksClient } from "../features/tasks/web";
import { vehiclesClient } from "../features/vehicles/web";
import { AppShell } from "./shell";

createKumikoApp({
  shell: AppShell,
  clientFeatures: [
    localeDeClient(),
    emailPasswordClient(),
    tasksClient,
    rentalClient,
    vehiclesClient,
    billingClient,
    textBlocksClient(),
    documentDesignerClient(),
  ],
});
