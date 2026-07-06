import { adminShellClient } from "@cosmicdrift/kumiko-bundled-features/admin-shell/web";
import { auditClient } from "@cosmicdrift/kumiko-bundled-features/audit/web";
import { emailPasswordClient } from "@cosmicdrift/kumiko-bundled-features/auth-email-password/web";
import { jobsClient } from "@cosmicdrift/kumiko-bundled-features/jobs/web";
import { tenantClient } from "@cosmicdrift/kumiko-bundled-features/tenant/web";
import { tierEngineClient } from "@cosmicdrift/kumiko-bundled-features/tier-engine/web";
import { createKumikoApp } from "@cosmicdrift/kumiko-renderer-web";
import { AppShell } from "./shell";

createKumikoApp({
  shell: AppShell,
  clientFeatures: [
    emailPasswordClient(),
    adminShellClient(),
    tenantClient(),
    auditClient(),
    jobsClient(),
    tierEngineClient(),
  ],
});
