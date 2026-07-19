import { adminShellClient } from "@cosmicdrift/kumiko-bundled-features/admin-shell/web";
import { auditClient } from "@cosmicdrift/kumiko-bundled-features/audit/web";
import { emailPasswordClient } from "@cosmicdrift/kumiko-bundled-features/auth-email-password/web";
import { jobsClient } from "@cosmicdrift/kumiko-bundled-features/jobs/web";
import { tenantClient } from "@cosmicdrift/kumiko-bundled-features/tenant/web";
import { tierEngineClient } from "@cosmicdrift/kumiko-bundled-features/tier-engine/web";
import { createKumikoApp } from "@cosmicdrift/kumiko-renderer-web";
import { HomeScreen } from "./home-screen";
import { AppShell } from "./shell";

createKumikoApp({
  shell: AppShell,
  // admin-console has only role-gated screens (no open app screen), so
  // createKumikoApp needs an explicit screenQn, otherwise firstOpenScreenQn()
  // crashes at boot. home:screen:home is the only screen without access.roles;
  // WorkspaceShell immediately overrides it with the role-appropriate default screen.
  screenQn: "home:screen:home",
  clientFeatures: [
    emailPasswordClient(),
    { name: "home", components: { "admin-console-home": HomeScreen } },
    adminShellClient(),
    tenantClient(),
    auditClient(),
    jobsClient(),
    tierEngineClient(),
  ],
});
