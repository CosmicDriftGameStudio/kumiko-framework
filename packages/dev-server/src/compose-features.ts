// composeFeatures — single source of truth für die Feature-Liste die
// Boot UND Schema-Generator sehen.
//
// Sowohl runDevApp als auch runProdApp mischen im auth-mode dieselben
// vier Bundled-Features dazu (config + user + tenant + auth-email-pw).
// Damit der drizzle-Schema-Generator pro App genau dieselbe Feature-
// Liste sieht wie die Runtime, leben die Komposition hier — beide
// Bootstrap-Wrapper UND der per-app drizzle/generate.ts rufen sie auf.
//
// Reihenfolge: Infrastruktur-Features (config/user/tenant) zuerst, dann
// auth-email-password, dann die App-Features. Spätere Features dürfen
// auf Frühere referenzieren (z.B. authClaims-Hooks an user/tenant).

import {
  type AuthEmailPasswordOptions,
  createAuthEmailPasswordFeature,
} from "@kumiko/bundled-features/auth-email-password";
import { createConfigFeature } from "@kumiko/bundled-features/config";
import { createTenantFeature } from "@kumiko/bundled-features/tenant";
import { createUserFeature } from "@kumiko/bundled-features/user";
import type { FeatureDefinition } from "@kumiko/framework/engine";

export type ComposeFeaturesOptions = {
  /** When true, prepends config + user + tenant + auth-email-password
   *  before the app features. Mirror of "auth-mode" in run{Dev,Prod}App. */
  readonly includeBundled: boolean;
  /** Optional auth-feature-options durchgereicht an
   *  createAuthEmailPasswordFeature. Wenn passwordReset / emailVerification
   *  hier gesetzt sind, registriert das Feature die request-/confirm-
   *  Handler — sonst NICHT (500 wenn die routes via auth-routes.ts
   *  gemounted sind aber kein Handler dispatcht). Hand-in-hand mit dem
   *  passwordReset-Block in RunProdAppAuthOptions / RunDevAppAuthOptions. */
  readonly authOptions?: AuthEmailPasswordOptions;
};

export function composeFeatures(
  appFeatures: readonly FeatureDefinition[],
  options: ComposeFeaturesOptions,
): FeatureDefinition[] {
  return options.includeBundled
    ? [
        createConfigFeature(),
        createUserFeature(),
        createTenantFeature(),
        createAuthEmailPasswordFeature(options.authOptions ?? {}),
        ...appFeatures,
      ]
    : [...appFeatures];
}
