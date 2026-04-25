// Dev-server für den workspaces Sample. Auth-Mode aktiv: der Client
// muss sich über den Login-Screen anmelden, bevor der WorkspaceShell
// rendert. WorkspaceShell filtert die sichtbaren Workspaces nach den
// `user.roles` aus der Session — Admin sieht alle drei, andere Rollen
// nur ihre.
//
// Die hand-geschriebene clientSchema-Spiegelung ist obsolet — der dev-
// server resolved das AppSchema via buildAppSchema(registry) und
// injiziert es als window.__KUMIKO_SCHEMA__.

import {
  AuthErrors,
  AuthHandlers,
  createAuthEmailPasswordFeature,
} from "@kumiko/bundled-features/auth-email-password";
import { createConfigFeature, createConfigResolver } from "@kumiko/bundled-features/config";
import { createTenantFeature, TenantQueries } from "@kumiko/bundled-features/tenant";
import { createUserFeature } from "@kumiko/bundled-features/user";
import { createKumikoServer } from "@kumiko/framework/dev-server";
import { demoFeature, driverFeature } from "./feature";
import { seedAdminUser } from "./seed";

await createKumikoServer({
  features: [
    createConfigFeature(),
    createUserFeature(),
    createTenantFeature(),
    createAuthEmailPasswordFeature(),
    demoFeature,
    driverFeature,
  ],
  clientEntry: "./src/client.tsx",
  htmlPath: "./public/index.html",
  watchDirs: ["./src"],
  extraContext: { configResolver: createConfigResolver() },
  auth: {
    membershipQuery: TenantQueries.memberships,
    loginHandler: AuthHandlers.login,
    loginErrorStatusMap: {
      [AuthErrors.invalidCredentials]: 401,
      [AuthErrors.noMembership]: 403,
    },
  },
  onAfterSetup: async (stack) => {
    await seedAdminUser(stack);
  },
});
