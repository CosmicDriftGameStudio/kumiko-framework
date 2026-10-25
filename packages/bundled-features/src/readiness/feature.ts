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
import { runDetailQuery } from "./handlers/run-detail.query.ts";
import { runListQuery } from "./handlers/run-list.query.ts";
import { runProbesWrite } from "./handlers/run-probes.write.ts";
import { runResultsQuery } from "./handlers/run-results.query.ts";
import { statusQuery } from "./handlers/status.query.ts";
import { READINESS_I18N } from "./i18n.ts";
import { validateProbeTranslations } from "./probe-boot-check.ts";
import { runProbesJob } from "./run-probes-job.ts";
import { probeRunEntity } from "./schema/probe-run.ts";
import {
  SYSTEM_CHECK_NAV_LABEL,
  SYSTEM_CHECK_SCREEN_ID,
  SYSTEM_CHECK_SCREEN_QN,
  systemCheckRunScreen,
  systemCheckScreen,
} from "./screens.ts";

export interface ReadinessNavOptions {
  readonly order?: number;
  readonly parent?: string;
  // Workspace apps need it: a nav belongs only to the workspaces it names, a parent's do not carry over.
  readonly workspaces?: readonly string[];
}

export interface ReadinessFeatureOptions {
  // Without a nav entry the system-check screen stays dormant; apps link it themselves.
  readonly nav?: ReadinessNavOptions;
}

const DEFAULT_NAV_ORDER = 90;

export function createReadinessFeature(options: ReadinessFeatureOptions = {}) {
  const { nav } = options;
  return defineFeature(
    "readiness",
    (r) => {
      r.describe(
        "One-call tenant-onboarding probe: `readiness:query:status` rolls up every config key and secret declared `required: true` across all mounted features and reports which still lack a usable value for the calling tenant, plus a single `ready` boolean. Provider-features under an `r.extensionSelector`-declared extension point count only while their provider is the selected one — a tenant on the inmemory mail transport is not blocked by unset SMTP keys. Mount it (together with `config` and `secrets`) when an admin UI needs a settings checklist before the first mail-send or file-write; the per-concern lists stay available via `config:query:readiness` and `secrets:query:list`. `readiness:write:run-probes` runs the live probes features register with `r.probe` (mail, files, mailboxes, PDF service and more) as a job; the system-check screen shows the latest run and the history once `nav` is passed.",
      );
      r.uiHints({
        displayLabel: "Readiness · Onboarding Probe",
        category: "operations",
        recommended: false,
      });
      r.requires({ features: ["config"] });
      r.requires({ features: ["secrets"] });
      r.optionalRequires("user");
      r.adoptsBundledLists();

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
          grants: ["systemIdentity"],
        },
        // Inline so the feature-AST reader can parse the job; the logic lives in run-probes-job.ts.
        handler: (payload, ctx) => runProbesJob(payload, ctx),
      });
      registerBuiltInProbes(r);
      r.bootCheck(({ features }) => validateProbeTranslations(features));

      r.screen(systemCheckScreen(nav === undefined));
      r.screen(systemCheckRunScreen);
      if (nav !== undefined) {
        // Explicit property assignments: the feature-AST parser reads neither `??`, shorthand
        // properties nor a conditional spread, and the boot validator treats `parent: undefined`
        // as a top-level entry.
        const {
          order: navOrder = DEFAULT_NAV_ORDER,
          parent: navParent,
          workspaces: navWorkspaces,
        } = nav;
        r.nav({
          id: SYSTEM_CHECK_SCREEN_ID,
          label: SYSTEM_CHECK_NAV_LABEL,
          icon: "shield-check",
          screen: SYSTEM_CHECK_SCREEN_QN,
          order: navOrder,
          parent: navParent,
          workspaces: navWorkspaces,
        });
      }

      const queries = {
        status: r.queryHandler(statusQuery),
        latestResults: r.queryHandler(latestResultsQuery),
        latestSummary: r.queryHandler(latestSummaryQuery),
        runList: r.queryHandler(runListQuery),
        runDetail: r.queryHandler(runDetailQuery),
        runResults: r.queryHandler(runResultsQuery),
      };

      return { queries };
    },
    {
      dedupeOptions: {
        hasNav: nav !== undefined,
        navOrder: nav?.order ?? DEFAULT_NAV_ORDER,
        navParent: nav?.parent ?? "",
        navWorkspaces: nav?.workspaces?.join(",") ?? "",
      },
    },
  );
}
