// @runtime client
// Client-Feature-Factory für user-data-rights. Liefert die ExportSection-
// Extension-Component für den privacy-center-Screen (server-seitig
// deklarativ als `type: "projectionDetail"` registriert, siehe feature.ts —
// Restriction/Deletion sind Felder/Actions auf dem Screen selbst und
// brauchen keine Client-Component) + Default-Translations. Apps hängen es
// in createKumikoApp({ clientFeatures: [userDataRightsClient()] }) ein; der
// Screen hat kein eigenes r.nav, die App platziert ihn via r.nav.
//
// fw#2312: die vormalige `privacyCenter: { showDeletion }`-Option ist
// entfallen — ein deklarativer Screen wird einmal server-seitig für alle
// Apps registriert, ein Client-Prop kann seine Sections/Actions nicht mehr
// pro App umschalten. Ersatz ist die server-seitige
// `UserDataRightsOptions.privacyCenterShowDeletion` (createUserDataRightsFeature,
// ../feature.ts) — BREAKING, Consumer mit `showDeletion: false` (z.B.
// money-horse) müssen die Option beim Feature-Setup nachziehen.

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
