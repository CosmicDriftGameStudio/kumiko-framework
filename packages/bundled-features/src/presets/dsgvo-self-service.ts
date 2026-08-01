import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { createComplianceProfilesFeature } from "../compliance-profiles";
import { createDataRetentionFeature } from "../data-retention";
import { createSessionsFeature } from "../sessions";
import { createUserDataRightsFeature, type UserDataRightsOptions } from "../user-data-rights";
import { createUserProfileFeature } from "../user-profile";

export type DsgvoSelfServiceOptions = {
  /** Passed through to createUserDataRightsFeature — export/deletion mail
   *  callbacks + Apex deletion HMAC. Default {} (no-op mail side). */
  readonly userDataRights?: UserDataRightsOptions;
};

// DSGVO + account self-service chain every Kumiko SaaS app mounts (privacy
// center, account deletion Art. 17, export Art. 20, sessions). Order is
// load-bearing (require-order): user-data-rights needs data-retention +
// compliance-profiles + sessions, user-profile needs user-data-rights. This
// exact order used to be hand-copied into every app with an explainer
// comment. text-content + legal-pages stay out deliberately — legal-pages
// has an app-specific wrapLayout, text-content is a standalone foundation;
// both are spread in by the app itself.
export function dsgvoSelfServiceFeatures(opts: DsgvoSelfServiceOptions = {}): FeatureDefinition[] {
  return [
    createDataRetentionFeature(),
    createComplianceProfilesFeature(),
    createSessionsFeature(),
    createUserDataRightsFeature(opts.userDataRights ?? {}),
    createUserProfileFeature(),
  ];
}
