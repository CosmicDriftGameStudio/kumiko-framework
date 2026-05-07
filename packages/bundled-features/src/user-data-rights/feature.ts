import {
  EXT_USER_DATA,
  defineFeature,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";

// user-data-rights — DSGVO Art. 15 (Auskunft) + Art. 17 (Löschung) +
// Art. 18 (Restriction) + Art. 20 (Portabilität) als Core-Feature.
//
// Pattern (Plan-Roadmap docs/plans/datenschutz/user-data-rights.md):
// Statt jedes Feature seine eigene Forget-/Export-Logik schreibt,
// haengt es sich via `r.useExtension(EXT_USER_DATA, "<entity>", {
// export, delete })` an. user-data-rights orchestriert:
//   - Export-Job: iteriert alle Extension-Registrierungen, sammelt JSON
//   - Forget-Job: iteriert alle, ruft delete-Hook mit Strategy aus
//                 retention.policyFor (data-retention)
//   - Restriction: status-Flip auf user-Schema, Auth-Middleware-Guard
//
// Sprint 2.U2 (this commit): Feature scaffold + EXT_USER_DATA-Extension-
// Marker via r.extendsRegistrar. Andere features in Sprint 2.H1+H2
// haengen sich via useExtension an.
//
// Sprint 2.U3+U4: Async-Export-Job + Endpoints
// Sprint 2.U5: Forget-Pfad mit Grace + Cron-Cleanup
// Sprint 2.U6: Restriction (Art. 18) + Auth-Middleware-Guard
// Sprint 2.U7: audit-log + data-summary Queries
//
// Cross-Feature-API:
//   r.exposesApi("userDataRights.runForget") — Sprint 2.U5
//   r.exposesApi("userDataRights.runExport") — Sprint 2.U3
//
// Cross-Feature-Reads:
//   r.usesApi("compliance.forTenant")  — Forget-Grace aus Profile
//   r.usesApi("retention.policyFor")    — blockDelete-Konsultation
export function createUserDataRightsFeature(): FeatureDefinition {
  return defineFeature("user-data-rights", (r) => {
    r.requires("user", "data-retention", "compliance-profiles");
    r.usesApi("compliance.forTenant");
    r.usesApi("retention.policyFor");

    // EXT_USER_DATA — Schema-Marker fuer userData-Hooks. Andere features
    // (Sprint 2.H1+H2) registrieren via:
    //   r.useExtension(EXT_USER_DATA, "<entity>", { export, delete })
    //
    // Hooks-Signatur: framework/src/engine/extensions/user-data.ts
    // (UserDataExtensionHooks-Type aus S1.9 Z1).
    //
    // Boot-Validation der Hook-Shape kommt in S2.U3 wenn der Export-Runner
    // die Hooks zur Laufzeit ruft — dann faengt boot-validator falsch
    // typed Hooks frueh ab.
    r.extendsRegistrar(EXT_USER_DATA, {});
  });
}
