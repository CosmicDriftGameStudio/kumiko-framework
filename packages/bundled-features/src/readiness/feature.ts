// kumiko-feature-version: 1
//
// readiness — one-call tenant-onboarding rollup above config + secrets.
//
// `config:query:readiness` lists required config keys without a usable
// value; `secrets:query:list` lists set secrets. Neither can verdict
// "tenant is ready" alone. This feature requires both, so its status
// query may roll up missing config + missing required secrets + a single
// `ready` boolean — the settings-checklist call for admin UIs.

import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { statusQuery } from "./handlers/status.query";

export const readinessFeature = defineFeature("readiness", (r) => {
  r.describe(
    "One-call tenant-onboarding probe: `readiness:query:status` rolls up every config key and secret declared `required: true` across all mounted features and reports which still lack a usable value for the calling tenant, plus a single `ready` boolean. Provider-features under an `r.extensionSelector`-declared extension point count only while their provider is the selected one — a tenant on the inmemory mail transport is not blocked by unset SMTP keys. Mount it (together with `config` and `secrets`) when an admin UI needs a settings checklist before the first mail-send or file-write; the per-concern lists stay available via `config:query:readiness` and `secrets:query:list`.",
  );
  r.uiHints({
    displayLabel: "Readiness · Onboarding Probe",
    category: "operations",
    recommended: false,
  });
  r.requires("config");
  r.requires("secrets");

  const queries = {
    status: r.queryHandler(statusQuery),
  };

  return { queries };
});
