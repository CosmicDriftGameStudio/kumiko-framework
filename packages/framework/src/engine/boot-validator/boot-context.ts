import type { ConfigKeyDefinition } from "@cosmicdrift/kumiko-types/config";
import { QnTypes, qualifyEntityName } from "../qualified-name.ts";
import type { FeatureDefinition } from "../types/index.ts";
import { BOOT_ENVIRONMENT_RULES } from "./boot-environment-rules.ts";
import type { ValidateBootOptions } from "./boot-options.ts";
import { bootRuleError } from "./boot-rule.ts";
import { collectKnownRoles, collectNavQns, collectWriteHandlerQns } from "./nav.ts";
import { collectClaimKeys } from "./ownership.ts";
import { buildQueryHandlerMap } from "./projection-list-screens.ts";
import { collectScreenQns, collectScreensByShortId } from "./screens.ts";
import { collectWorkspaceQns } from "./workspaces.ts";

export type BootContext = {
  readonly features: readonly FeatureDefinition[];
  readonly featureMap: ReadonlyMap<string, FeatureDefinition>;
  readonly options: ValidateBootOptions | undefined;
  readonly extensionProviders: ReadonlyMap<string, string>;
  readonly allConfigKeys: ReadonlySet<string>;
  readonly configKeyDefsByQn: ReadonlyMap<string, ConfigKeyDefinition>;
  readonly allClaimKeys: ReturnType<typeof collectClaimKeys>;
  readonly knownRoles: ReturnType<typeof collectKnownRoles>;
  readonly allScreenQns: ReturnType<typeof collectScreenQns>;
  readonly allNavQns: ReturnType<typeof collectNavQns>;
  readonly allWorkspaceQns: ReturnType<typeof collectWorkspaceQns>;
  readonly allWriteHandlerQns: ReturnType<typeof collectWriteHandlerQns>;
  readonly screensByShortId: ReturnType<typeof collectScreensByShortId>;
  readonly queryHandlerQns: ReturnType<typeof buildQueryHandlerMap>;
};

export function buildBootContext(
  features: readonly FeatureDefinition[],
  options: ValidateBootOptions | undefined,
): BootContext {
  const featureMap = new Map<string, FeatureDefinition>();
  const extensionProviders = new Map<string, string>();
  const allConfigKeys = new Set<string>();
  // The raw f.configKeys key is the camelCase object key; the QN is built by
  // define-feature/registry via qualifyEntityName (kebab-cased), so configEdit
  // screens with multi-word keys only resolve against the qualified form.
  // allConfigKeys keeps the older `feature.key` form for validateConfigReads.
  const configKeyDefsByQn = new Map<string, ConfigKeyDefinition>();
  for (const f of features) {
    featureMap.set(f.name, f);
    for (const extName of Object.keys(f.registrarExtensions)) {
      extensionProviders.set(extName, f.name);
    }
    for (const [key, def] of Object.entries(f.configKeys)) {
      allConfigKeys.add(`${f.name}.${key}`);
      configKeyDefsByQn.set(qualifyEntityName(f.name, QnTypes.config, key), def);
    }
  }
  return {
    features,
    featureMap,
    options,
    extensionProviders,
    allConfigKeys,
    configKeyDefsByQn,
    allClaimKeys: collectClaimKeys(features),
    // Corpus of "referenced in any handler access rule" (there is no runtime
    // role registry), so typos like "Admi" fail at boot.
    knownRoles: collectKnownRoles(features),
    allScreenQns: collectScreenQns(features),
    allNavQns: collectNavQns(features),
    allWorkspaceQns: collectWorkspaceQns(features),
    allWriteHandlerQns: collectWriteHandlerQns(features),
    screensByShortId: collectScreensByShortId(features),
    queryHandlerQns: buildQueryHandlerMap(features),
  };
}

export function collectExposedApis(features: readonly FeatureDefinition[]): Map<string, string> {
  const allExposedApis = new Map<string, string>(); // apiName → providerFeature
  for (const f of features) {
    for (const apiName of f.exposedApis) {
      const existing = allExposedApis.get(apiName);
      if (existing && existing !== f.name) {
        throw bootRuleError(BOOT_ENVIRONMENT_RULES.duplicateExposedApi, {
          message: `Cross-feature API "${apiName}" exposed by both "${existing}" and "${f.name}" — API names must be globally unique.`,
        });
      }
      allExposedApis.set(apiName, f.name);
    }
  }
  return allExposedApis;
}
