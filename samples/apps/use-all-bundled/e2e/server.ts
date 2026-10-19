// @runtime test
//

// E2E boot: the dev app plus the seedTenant() routes, so specs like
// mfa-login.spec.ts get their own tenant/user instead of the shared admin.
import { runDevApp } from "@cosmicdrift/kumiko-dev-server";
import { createE2eSeedRoutes } from "@cosmicdrift/kumiko-dev-server/testing";
import { devAppOptions } from "../src/app/dev-app-options";

await runDevApp({ ...devAppOptions, extraRoutes: createE2eSeedRoutes() });
