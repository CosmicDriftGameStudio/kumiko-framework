import { validateEntityFieldEncryptionAvailable } from "../../db/entity-field-encryption.ts";
import { FILE_STORAGE_PROVIDER_ENV } from "../extension-names.ts";
import { createRegistry } from "../registry.ts";
import type { Registry } from "../types/index.ts";
import { validateProjectionAllowlist } from "../validate-projection-allowlist.ts";
import { runFeatureBootCheck } from "./boot-check.ts";
import type { BootContext } from "./boot-context.ts";
import type { FeatureFlags } from "./boot-phases.ts";
import type { BootReport } from "./boot-report.ts";
import { validateCardMetaOverflow } from "./card-meta-overflow.ts";
import { validateConfigReads } from "./config-deps.ts";
import { validateExtensionPreSaveWiring } from "./entity-handler.ts";
import { validateEntityListScreens } from "./entity-list-screens.ts";
import { validateGdprStoragePersistence } from "./gdpr-storage.ts";
import { validateGlobalTenancyEntities } from "./global-tenancy.ts";
import {
  validateI18nSurfaceKeys,
  validateRequiredLocales,
  validateTranslationLocaleConsistency,
} from "./i18n-keys.ts";
import { validateNavCycles } from "./nav.ts";
import {
  validateProjectionListScreens,
  validateRelatedListSectionQueries,
} from "./projection-list-screens.ts";
import { validateQueryOutputColumns } from "./query-output-columns.ts";
import { validateExtensionSelectorPanels } from "./selector-owner-panels.ts";
import { validateSubmitPrefilledHiddenFields } from "./url-prefill-fields.ts";
import { validateDefaultWorkspaceUniqueness } from "./workspaces.ts";

type AppCheck = {
  readonly check: string;
  readonly run: (ctx: BootContext) => unknown;
};

const APP_CHECKS_AFTER_I18N: readonly AppCheck[] = [
  {
    check: "validateTranslationLocaleConsistency",
    run: (c) => validateTranslationLocaleConsistency(c.features),
  },
  {
    check: "validateRequiredLocales",
    run: (c) => validateRequiredLocales(c.features, c.options?.requiredLocales),
  },
  { check: "validateEntityListScreens", run: (c) => validateEntityListScreens(c.features) },
  {
    check: "validateSubmitPrefilledHiddenFields",
    run: (c) => validateSubmitPrefilledHiddenFields(c.features),
  },
  { check: "validateCardMetaOverflow", run: (c) => validateCardMetaOverflow(c.features) },
  {
    check: "validateExtensionSelectorPanels",
    run: (c) => validateExtensionSelectorPanels(c.features),
  },
  // Column/field checks assume every `query` string already resolves (validateQueryRefs, phase 1).
  { check: "validateQueryOutputColumns", run: (c) => validateQueryOutputColumns(c.features) },
  {
    check: "validateProjectionListScreens",
    run: (c) => validateProjectionListScreens(c.features),
  },
  {
    check: "validateRelatedListSectionQueries",
    run: (c) => validateRelatedListSectionQueries(c.features),
  },
  {
    check: "validateExtensionPreSaveWiring",
    run: (c) => validateExtensionPreSaveWiring(c.features),
  },
  {
    check: "validateGdprStoragePersistence",
    run: (c) => validateGdprStoragePersistence(c.features),
  },
  {
    check: "validateGlobalTenancyEntities",
    run: (c) => validateGlobalTenancyEntities(c.features),
  },
];

function runFeatureBootChecks(report: BootReport, ctx: BootContext): void {
  for (const feature of ctx.features) {
    for (const check of feature.bootChecks) {
      report.check("runFeatureBootCheck", feature.name, () =>
        runFeatureBootCheck(feature, check, ctx.features),
      );
    }
  }
}

export function runAppWidePhase(report: BootReport, ctx: BootContext): void {
  const { features } = ctx;
  report.check("validateNavCycles", undefined, () => validateNavCycles(ctx.allNavQns));
  report.check("validateDefaultWorkspaceUniqueness", undefined, () =>
    validateDefaultWorkspaceUniqueness(ctx.allWorkspaceQns),
  );
  const built: { registry?: Registry } = {};
  report.check("createRegistry", undefined, () => {
    built.registry = createRegistry(features);
  });
  const registry = built.registry;
  if (registry !== undefined) {
    report.check("validateI18nSurfaceKeys", undefined, () =>
      validateI18nSurfaceKeys(features, registry),
    );
  }
  for (const { check, run } of APP_CHECKS_AFTER_I18N) {
    report.check(check, undefined, () => run(ctx));
  }
  runFeatureBootChecks(report, ctx);
  report.check("validateProjectionAllowlist", undefined, () =>
    validateProjectionAllowlist(features),
  );
  report.check("validateConfigReads", undefined, () =>
    validateConfigReads(features, ctx.allConfigKeys),
  );
}

// Independent of the earlier phases: whether the environment can serve the app is
// a separate question from whether its definitions are consistent.
export function runEnvironmentPhase(
  report: BootReport,
  ctx: BootContext,
  flags: FeatureFlags,
): void {
  const { options } = ctx;
  if (flags.hasEncryptedFields) {
    // Availability check, not env-presence: eagerly building the keyring
    // catches malformed keys (wrong length, bad base64) at boot instead of
    // on the first encrypted read in prod. An injected cipher (test seam,
    // custom KMS provider) satisfies the requirement without env keys.
    report.check("validateEntityFieldEncryptionAvailable", undefined, () =>
      validateEntityFieldEncryptionAvailable(options?.env, options?.entityFieldCipher),
    );
  }
  report.check("fileStorageProvider", undefined, () => {
    if (flags.hasFileFields && !(options?.env ?? process.env)[FILE_STORAGE_PROVIDER_ENV]) {
      throw new Error(
        `${FILE_STORAGE_PROVIDER_ENV} environment variable is required (file/image fields in use)`,
      );
    }
  });
}
