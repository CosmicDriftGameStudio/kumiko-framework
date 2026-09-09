// @runtime client
// Client-feature factory for user-data-rights. Provides the ExportSection
// extension component for the privacy-center screen (registered server-side
// declaratively as `type: "projectionDetail"`, see feature.ts — restriction
// and deletion are fields/actions on the screen itself and need no client
// component) + default translations. Apps wire it in via
// createKumikoApp({ clientFeatures: [userDataRightsClient()] }); the screen
// has no own r.nav, the app places it via r.nav.
//
// fw#2312: the former `privacyCenter: { showDeletion }` option is gone — a
// declarative screen is now registered server-side once for all apps, so a
// client prop can no longer toggle its sections/actions per app. Its
// replacement is the server-side
// `UserDataRightsOptions.privacyCenterShowDeletion` (createUserDataRightsFeature,
// ../feature.ts) — BREAKING, consumers with `showDeletion: false` (e.g.
// money-horse) must carry the option over at feature setup.

import { mergeTranslations, type TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import { EXPORT_SECTION_EXTENSION_NAME, USER_DATA_RIGHTS_FEATURE } from "../constants";
import { defaultTranslations } from "./i18n";
import { ExportSection } from "./privacy-center-screen";
import { makePublicDeletionGate, type PublicDeletionRoutes } from "./public-deletion-gate";

export type UserDataRightsClientOptions = {
  /** Key-weise Overrides über die Default-Bundles (de/en). */
  readonly translations?: TranslationsByLocale;
  /** Wenn gesetzt: registriert die anonymen (login-freien) Lösch-Screens als
   *  Gate auf den angegebenen Pfaden. Weglassen → nur der eingeloggte
   *  privacy-center-Screen. Den Client VOR dem Auth-Client listen, sonst
   *  landet der anonyme Besucher auf der Login-Maske. */
  readonly publicDeletion?: PublicDeletionRoutes;
};

export function userDataRightsClient(
  options?: UserDataRightsClientOptions,
): ClientFeatureDefinition {
  const base: ClientFeatureDefinition = {
    name: USER_DATA_RIGHTS_FEATURE,
    translations: mergeTranslations(defaultTranslations, options?.translations ?? {}),
    extensionSectionComponents: {
      [EXPORT_SECTION_EXTENSION_NAME]: ExportSection,
    },
  };
  if (options?.publicDeletion === undefined) return base;
  // Extend, not overwrite (570/2) — base.gates is empty today, but a spread
  // that clobbers it instead of appending would silently drop future gates.
  return {
    ...base,
    gates: [...(base.gates ?? []), makePublicDeletionGate(options.publicDeletion)],
  };
}
