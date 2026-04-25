// Dev-Server für ui-walkthrough. Der ganze Boilerplate
// (Client-Bundle, setupTestStack, SSE-Reload, SIGINT cleanup) lebt in
// @kumiko/dev-server. Braucht Postgres + Redis (siehe
// `yarn kumiko dev`). Persistent-DB-Modus: setze KUMIKO_DEV_DB_NAME
// in der Umgebung.
//
// Auth-Mode: features + `auth` gesetzt → kein Auto-Mint-JWT mehr, der
// Client muss sich über den Login-Screen gegen POST /api/auth/login
// authentifizieren. Der Admin-User wird von seedAdminUser() beim Boot
// angelegt (idempotent, über die offiziellen Handler-QNs).

import {
  AuthErrors,
  AuthHandlers,
  createAuthEmailPasswordFeature,
} from "@kumiko/bundled-features/auth-email-password";
import { createConfigFeature, createConfigResolver } from "@kumiko/bundled-features/config";
import { createTenantFeature, TenantQueries } from "@kumiko/bundled-features/tenant";
import { createUserFeature } from "@kumiko/bundled-features/user";
import { createKumikoServer } from "@kumiko/dev-server";
import { taskFeature } from "./feature";
import { seedAdminUser } from "./seed";

await createKumikoServer({
  features: [
    createConfigFeature(),
    createUserFeature(),
    createTenantFeature(),
    createAuthEmailPasswordFeature(),
    taskFeature,
  ],
  clientEntry: "./src/client.tsx",
  // stylesheet: default via @kumiko/renderer-web/styles.css package-export
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
