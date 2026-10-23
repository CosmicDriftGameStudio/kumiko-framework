// composeFeatures — single source of truth for the feature list that
// boot AND the schema generator see.
//
// Both runDevApp and runProdApp mix in the same bundled features in
// auth-mode (config + user + tenant + auth-email-password, plus
// auth-self-registration when authOptions.signup is set). So the
// drizzle schema generator sees the exact same feature list per app as
// the runtime, the composition lives here — both bootstrap wrappers AND
// each app's drizzle/generate.ts call it.
//
// Order: infrastructure features (config/user/tenant) first, then
// auth-email-password (+ auth-self-registration when authOptions.signup
// is set), then the app features. Later features may reference earlier
// ones (e.g. authClaims hooks on user/tenant).

import {
  AUTH_SELF_REGISTRATION_FEATURE,
  type AuthEmailPasswordOptions,
  createAuthEmailPasswordFeature,
  createAuthSelfRegistrationToggleFeature,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import {
  AUTH_MFA_FEATURE,
  mfaStatusCheckerFromFeature,
} from "@cosmicdrift/kumiko-bundled-features/auth-mfa";
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import {
  createFilesTenantDataFeature,
  FILES_TENANT_DATA_FEATURE,
} from "@cosmicdrift/kumiko-bundled-features/files-tenant-data";
import { createRendererFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import { createTemplateResolverFeature } from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import {
  collectAssignableAppRoles,
  createTenantFeature,
} from "@cosmicdrift/kumiko-bundled-features/tenant";
import { TENANT_LIFECYCLE_FEATURE } from "@cosmicdrift/kumiko-bundled-features/tenant-lifecycle";
import { createUserFeature } from "@cosmicdrift/kumiko-bundled-features/user";
import {
  type BundledListsOptions,
  dedupeFeatures,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { FILES_FEATURE } from "@cosmicdrift/kumiko-framework/files";
import { createRendererMailHtmlFeature } from "@cosmicdrift/kumiko-renderer-mail-html";
import { applyBundledListsTable } from "./bundled-lists-table.ts";

export { type AuthOptionsCarrier, buildComposeAuthOptions } from "./compose-auth-options.ts";

export type ComposeFeaturesOptions = {
  /** When true, prepends config + user + tenant + auth-email-password
   *  (+ auth-self-registration when authOptions.signup is set) before the
   *  app features. Mirror of "auth-mode" in run{Dev,Prod}App. */
  readonly includeBundled: boolean;
  /** Optional auth-feature options passed through to
   *  createAuthEmailPasswordFeature. When passwordReset / emailVerification
   *  are set here, the feature registers the request/confirm handlers —
   *  otherwise it doesn't (500 if the routes are mounted via
   *  auth-routes.ts but no handler dispatches). Goes hand-in-hand with the
   *  passwordReset block in RunProdAppAuthOptions / RunDevAppAuthOptions. */
  readonly authOptions?: AuthEmailPasswordOptions;
  /** One table block for every list screen and relatedList of the bundled features; screen-own keys win. */
  readonly bundledLists?: BundledListsOptions;
};

export function composeFeatures(
  appFeatures: readonly FeatureDefinition[],
  options: ComposeFeaturesOptions,
): FeatureDefinition[] {
  // ponytail: includeBundled:false skips the auth-mfa auto-wiring below —
  // an app composing its own foundation and mounting auth-mfa itself is
  // responsible for threading mfaStatusCheckerFromFeature(...) into its
  // own createAuthEmailPasswordFeature(...) call, or login silently
  // bypasses MFA. Upgrade if this trips someone: warn here when appFeatures
  // contains AUTH_MFA_FEATURE but includeBundled is false.
  if (!options.includeBundled)
    return applyBundledListsTable(dedupeFeatures(appFeatures), options.bundledLists);

  // Bundled foundation goes first so its instances carry the runDevApp /
  // runProdApp `authOptions` (passwordReset wiring etc.). App-features that
  // ALSO declare one of these names — e.g. the create-kumiko-app picker
  // hands back `createAuthEmailPasswordFeature()` because the user ticked
  // it — would otherwise crash createRegistry with "Duplicate feature".
  // Drop the app-side duplicates and warn so the user can clean run-config.
  //
  // auth-mfa is NOT part of the bundled foundation (apps opt in explicitly
  // via APP_FEATURES) — but if it's there, the login handler needs its
  // status-checker wired in at construction time, since createAuthEmail-
  // PasswordFeature is built right here, before the caller ever sees it.
  const dedupedAppFeatures = dedupeFeatures(appFeatures);
  const mfaFeature = dedupedAppFeatures.find((f) => f.name === AUTH_MFA_FEATURE);
  const authOptions = mfaFeature
    ? { ...options.authOptions, mfaStatusChecker: mfaStatusCheckerFromFeature(mfaFeature) }
    : options.authOptions;
  const bundled = [
    createConfigFeature(),
    createUserFeature(),
    // inviteScreen mirrors authOptions.invite: that's the exact option that
    // makes auth-email-password register the invite-create write-handler
    // the /members invite drawer is bound to — without this, includeBundled
    // apps that DO configure invite still get /members with no invite button.
    // tenant is built here, so the app features are the only source of
    // EXT_ASSIGNABLE_ROLE declarations the members/invite screens can list.
    createTenantFeature({
      inviteScreen: Boolean(authOptions?.invite),
      assignableAppRoles: collectAssignableAppRoles(dedupedAppFeatures),
    }),
    createAuthEmailPasswordFeature(authOptions ?? {}),
    // signup-request/signup-confirm are registered whenever authOptions.signup
    // is set (see above), but the handler itself no-ops unless the companion
    // toggle feature is mounted (ctx.hasFeature(AUTH_SELF_REGISTRATION_FEATURE))
    // — without this, apps using the includeBundled convenience path get
    // self-signup silently broken (always-200 anti-enumeration contract masks
    // it as success). Mount it alongside signup, default ON, matching the
    // "on unless an operator flips it off at runtime" contract.
    ...(authOptions?.signup !== undefined ? [createAuthSelfRegistrationToggleFeature()] : []),
  ];
  const bundledNames = new Set(bundled.map((f) => f.name));
  const filteredApp: FeatureDefinition[] = [];
  for (const f of dedupedAppFeatures) {
    if (bundledNames.has(f.name)) {
      // The toggle takes no options, so the app copy is identical. Apps still
      // need it in APP_FEATURES: the schema CLI and tests compose without
      // authOptions.signup and only get it from there.
      if (f.name === AUTH_SELF_REGISTRATION_FEATURE) continue;
      // biome-ignore lint/suspicious/noConsole: boot-time UX warning
      console.warn(
        `[composeFeatures] "${f.name}" already auto-mounted via includeBundled — dropping the explicit copy from APP_FEATURES. Remove it from run-config.ts to silence this warning.`,
      );
      continue;
    }
    filteredApp.push(f);
  }
  const names = new Set(filteredApp.map((f) => f.name));
  // Without it, tenant destroy leaves fileRef rows and stored binaries behind.
  const needsFilesTenantData =
    names.has(FILES_FEATURE) &&
    names.has(TENANT_LIFECYCLE_FEATURE) &&
    !names.has(FILES_TENANT_DATA_FEATURE);
  return applyBundledListsTable(
    [
      ...bundled,
      ...missingAuthMailStack(names),
      ...filteredApp,
      ...(needsFilesTenantData ? [createFilesTenantDataFeature()] : []),
    ],
    options.bundledLists,
  );
}

// auth-email-password declares its mails as stored templates, and the boot seed
// fails without the template-resolver and a mail renderer. Mounting the missing
// ones here keeps every includeBundled app bootable (also scaffolds); features
// the app already mounts are skipped because createRegistry rejects duplicates.
function missingAuthMailStack(mountedNames: ReadonlySet<string>): FeatureDefinition[] {
  return [
    createTemplateResolverFeature(),
    createRendererFoundationFeature(),
    createRendererMailHtmlFeature(),
  ].filter((feature) => !mountedNames.has(feature.name));
}
