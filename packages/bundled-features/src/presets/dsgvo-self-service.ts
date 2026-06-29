import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { createComplianceProfilesFeature } from "../compliance-profiles";
import { createDataRetentionFeature } from "../data-retention";
import { createSessionsFeature } from "../sessions";
import { createUserDataRightsFeature, type UserDataRightsOptions } from "../user-data-rights";
import { createUserProfileFeature } from "../user-profile";

export type DsgvoSelfServiceOptions = {
  /** Durchgereicht an createUserDataRightsFeature — Export-/Deletion-Mail-
   *  Callbacks + Apex-Deletion-HMAC. Default {} (no-op Mail-Side). */
  readonly userDataRights?: UserDataRightsOptions;
};

// DSGVO- + Account-Self-Service-Kette, die jede Kumiko-SaaS-App mountet
// (Privacy-Center, Account-Löschung Art. 17, Export Art. 20, Sessions).
// Die Reihenfolge IST load-bearing (Require-Order): user-data-rights braucht
// data-retention + compliance-profiles + sessions, user-profile braucht
// user-data-rights. Genau diese Order stand bisher in jeder App handkopiert
// mit Erklär-Kommentar. text-content + legal-pages bleiben bewusst draußen —
// legal-pages hat ein app-spezifisches wrapLayout, text-content ist
// standalone Foundation; beide spreaded die App selbst dazu.
export function dsgvoSelfServiceFeatures(opts: DsgvoSelfServiceOptions = {}): FeatureDefinition[] {
  return [
    createDataRetentionFeature(),
    createComplianceProfilesFeature(),
    createSessionsFeature(),
    createUserDataRightsFeature(opts.userDataRights ?? {}),
    createUserProfileFeature(),
  ];
}
