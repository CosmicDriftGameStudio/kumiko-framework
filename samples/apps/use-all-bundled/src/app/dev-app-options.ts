// @runtime dev
//
// Dev/screenshot server for the use-all-bundled sample. In auth mode runDevApp
// mixes in the 4 standard features (config/user/tenant/auth) automatically via
// composeFeatures(includeBundled) — exactly the 4 that APP_FEATURES deliberately
// omits — and seeds the admin in onAfterSetup. That way ONE app renders all
// bundled feature screens for the docs previews.
//
// globalRoles SystemAdmin: unlocks the platform screens (tenant-list,
// user-list, tier-admin, GDPR inspector). anonymousAccess + extraContext.text
// content: the public legal-pages routes (/legal/*).

import { createTemplateResolverApi } from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import type { RunDevAppOptions } from "@cosmicdrift/kumiko-dev-server";
import {
  FILE_STORAGE_PROVIDER_ENV,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { BUNDLED_LISTS } from "../bundled-lists";
import { AUTH_COMPOSE_OPTIONS, BOOT_FEATURES, VALIDATE_BOOT_OPTIONS } from "../run-config";
import { ADMIN_EMAIL, ADMIN_PASSWORD, BETA_TENANT_ID, DEV_TENANT_ID } from "./auth-constants";
import { invoiceReportsFeature } from "./invoice-reports-feature";
import { notesFeature } from "./notes-feature";
import { appScreensFeature } from "./screens-feature";
import { seedScreenshotData } from "./seed";

// tier-admin renders the honest empty state ("no TierMap configured") with the
// bare createTierEngineFeature() (from APP_FEATURES). A configured tierMap
// would activate the resolver on every write (incl. login) and needs
// per-tenant tier assignments — disproportionate for a preview screenshot.

export const devAppOptions = {
  // notesFeature is dev-only (app-owned tag host) — see notes-feature.ts for why
  // it stays out of APP_FEATURES. appScreensFeature places the user-profile screen.
  features: [...BOOT_FEATURES, appScreensFeature, notesFeature, invoiceReportsFeature],
  featureToggles: true,
  // documents has a file field, so the boot gate wants a storage provider; the seeded
  // file-foundation config selects the real one, so only the validation env names it.
  validateBootOptions: {
    ...VALIDATE_BOOT_OPTIONS,
    env: { [FILE_STORAGE_PROVIDER_ENV]: "inmemory", ...process.env },
  },
  bundledLists: BUNDLED_LISTS,
  port: Number.parseInt(process.env["PORT"] ?? "4186", 10),
  clientEntry: "./src/app/client.tsx",
  htmlPath: "./public/index.html",
  watchDirs: ["./src", "../../../packages/*/src"],
  anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID },
  extraContext: ({ db, registry }) => ({
    templateResolver: createTemplateResolverApi(db, registry),
  }),
  seeds: [seedScreenshotData],
  auth: {
    admin: {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      displayName: "Admin",
      // Platform-operator: schaltet die SystemAdmin-gegateten Screens frei.
      globalRoles: ["SystemAdmin"],
      memberships: [
        {
          tenantId: DEV_TENANT_ID as TenantId,
          tenantKey: "dev",
          tenantName: "Dev Tenant",
          // TenantAdmin alongside Admin: sessionChecker re-derives roles from
          // this membership row on every write (buildSessionRoles), discarding
          // any roles override baked into a hand-signed SessionUser — without
          // it, seedCustomFieldsAndFolders's TenantAdmin-gated writes 403.
          roles: ["Admin", "TenantAdmin"],
        },
        {
          tenantId: BETA_TENANT_ID as TenantId,
          tenantKey: "beta",
          tenantName: "Beta Tenant",
          roles: ["User"],
        },
      ],
    },
    // Coverage for auth-self-registration toggle (#1521 Option A).
    signup: AUTH_COMPOSE_OPTIONS.signup,
    // Registers invite-create so the seed can dispatch real invitations —
    // the delivery-log screenshot needs real attempts, not projection writes.
    invite: AUTH_COMPOSE_OPTIONS.invite,
    // Same three option objects kumiko.config.ts feeds composeFeatures, so the
    // linted feature list and the running dev app stay the same registry.
    passwordReset: AUTH_COMPOSE_OPTIONS.passwordReset,
    emailVerification: AUTH_COMPOSE_OPTIONS.emailVerification,
    accountUnlock: AUTH_COMPOSE_OPTIONS.accountUnlock,
  },
} satisfies RunDevAppOptions;
