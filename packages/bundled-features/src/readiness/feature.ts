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
import { registerBuiltInProbes } from "./built-in-probes.ts";
import { ReadinessWrites } from "./constants.ts";
import { latestResultsQuery } from "./handlers/latest-results.query.ts";
import { latestSummaryQuery } from "./handlers/latest-summary.query.ts";
import { probeCatalogQuery } from "./handlers/probe-catalog.query.ts";
import { runDetailQuery } from "./handlers/run-detail.query.ts";
import { runListQuery } from "./handlers/run-list.query.ts";
import { runProbesWrite } from "./handlers/run-probes.write.ts";
import { runResultsQuery } from "./handlers/run-results.query.ts";
import { statusQuery } from "./handlers/status.query.ts";
import { READINESS_I18N } from "./i18n.ts";
import { validateProbeTranslations } from "./probe-boot-check.ts";
import { runProbesJob } from "./run-probes-job.ts";
import { probeRunEntity } from "./schema/probe-run.ts";

export function createReadinessFeature() {
  return defineFeature(
    "readiness",
    (r) => {
      r.describe(
        "One-call tenant-onboarding probe: `readiness:query:status` rolls up every config key and secret declared `required: true` across all mounted features and reports which still lack a usable value for the calling tenant, plus a single `ready` boolean. Provider-features under an `r.extensionSelector`-declared extension point count only while their provider is the selected one — a tenant on the inmemory mail transport is not blocked by unset SMTP keys. Mount it (together with `config` and `secrets`) when an admin UI needs a settings checklist before the first mail-send or file-write; the per-concern lists stay available via `config:query:readiness` and `secrets:query:list`.",
      );
      r.uiHints({
        displayLabel: "Readiness · Onboarding Probe",
        category: "operations",
        recommended: false,
      });
      r.requires({ features: ["config"] });
      r.requires({ features: ["secrets"] });
      r.optionalRequires("user");

      r.translations({ keys: READINESS_I18N });
      r.entity({ name: "probe-run", ...probeRunEntity });
      r.writeHandler(runProbesWrite);
      r.job({
        name: "run-probes",
        trigger: { on: ReadinessWrites.runProbes },
        runIn: "worker",
        retries: 0,
        escapeHatch: {
          reason: "looks up the run starter's address via the system-only user auth lookup",
        },
        handler: runProbesJob,
      });
      registerBuiltInProbes(r);
      r.bootCheck(({ features }) => validateProbeTranslations(features));

      const queries = {
        status: r.queryHandler(statusQuery),
        latestResults: r.queryHandler(latestResultsQuery),
        latestSummary: r.queryHandler(latestSummaryQuery),
        runList: r.queryHandler(runListQuery),
        runDetail: r.queryHandler(runDetailQuery),
        runResults: r.queryHandler(runResultsQuery),
        probeCatalog: r.queryHandler(probeCatalogQuery),
      };

      return { queries };
    },
    { dedupeOptions: {} },
  );
}
