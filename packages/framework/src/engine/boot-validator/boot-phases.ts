import type { FeatureDefinition } from "../types/index.ts";
import { validateAccessDeclarations } from "./access-declarations.ts";
import { validateActionWiring, validateFieldWiring } from "./action-wiring.ts";
import { validateApiExposureMatching, validateExtensionUsages } from "./api-ext.ts";
import type { BootContext } from "./boot-context.ts";
import { collectExposedApis } from "./boot-context.ts";
import type { BootReport } from "./boot-report.ts";
import {
  validateCircularDeps,
  validateConfigKeyAllowPerRequest,
  validateConfigKeyBacking,
  validateConfigKeyBounds,
  validateConfigKeyComputed,
  validateConfigKeyOptionsQuery,
  validateConfigKeyPiiEncrypted,
  validateConfigKeyRequired,
} from "./config-deps.ts";
import { validateSqlDerivedFields } from "./derived-sql-fields.ts";
import { collectDetailForScreens } from "./detail-screens.ts";
import {
  validateDerivedFieldCollisions,
  validateEmbeddedFields,
  validateEncryptedFields,
  validateEntityIndexes,
  validateExtendSchemaCollisions,
  validateFileFields,
  validateHandlerAccess,
  validateLocatedTimestamps,
  validateLockedWhen,
  validateMultiStreamProjections,
  validateReferenceFields,
  validateSearchableFieldReadAccess,
  validateTransitions,
} from "./entity-handler.ts";
import { validateImageVariants } from "./entity-image-variants.ts";
import {
  validateEntitySelectAvailabilityQuery,
  validateEntitySelectConditionalOptions,
  validateEntitySelectOptionsQuery,
  validateMultiSelectFields,
} from "./entity-select.ts";
import { validateFieldConditions } from "./field-conditions.ts";
import { validateHandlerFieldReferences } from "./handler-field-references.ts";
import { validateNavs } from "./nav.ts";
import { validateOwnershipRules } from "./ownership.ts";
import { validateParentRefs } from "./parent-ref.ts";
import { validatePiiAndRetention } from "./pii-retention.ts";
import { validateQueryRefs } from "./query-refs.ts";
import { validateReadGates } from "./read-gate.ts";
import { validateRecordOwnedSubjects } from "./record-owned.ts";
import { validateScreenShortIdCollisions, validateScreens } from "./screens.ts";
import { validateTransferGraph } from "./transfer-graph.ts";
import { validateWorkspaces } from "./workspaces.ts";

type FeatureCheck = {
  readonly check: string;
  readonly run: (feature: FeatureDefinition, ctx: BootContext) => unknown;
};

export type FeatureFlags = { hasEncryptedFields: boolean; hasFileFields: boolean };

function runFeatureChecks(
  report: BootReport,
  checks: readonly FeatureCheck[],
  feature: FeatureDefinition,
  ctx: BootContext,
): void {
  for (const { check, run } of checks) {
    report.check(check, feature.name, () => run(feature, ctx));
  }
}

// Phase 1 breaks the shared lookup tables later checks resolve against; if it
// finds anything, the later phases would only report follow-up noise.
const STRUCTURE_FEATURE_CHECKS: readonly FeatureCheck[] = [
  { check: "validateCircularDeps", run: (f, c) => validateCircularDeps(f.name, c.featureMap) },
  {
    check: "validateExtensionUsages",
    run: (f, c) => validateExtensionUsages(f, c.extensionProviders),
  },
  {
    check: "validateReferenceFields",
    run: (f, c) => validateReferenceFields(f, c.featureMap, c.queryHandlerQns),
  },
  { check: "validateParentRefs", run: (f, c) => validateParentRefs(f, c.featureMap) },
];

type DetailForScreens = ReturnType<typeof collectDetailForScreens>;

export function runStructurePhase(report: BootReport, ctx: BootContext): DetailForScreens {
  const { features, featureMap } = ctx;
  const built: { exposedApis?: Map<string, string>; detailForScreens?: DetailForScreens } = {};
  report.check("validateScreenShortIdCollisions", undefined, () =>
    validateScreenShortIdCollisions(ctx.screensByShortId),
  );
  report.check("collectDetailForScreens", undefined, () => {
    built.detailForScreens = collectDetailForScreens(features, featureMap);
  });
  report.check("validateSqlDerivedFields", undefined, () => validateSqlDerivedFields(features));
  report.check("collectExposedApis", undefined, () => {
    built.exposedApis = collectExposedApis(features);
  });
  report.check("validateQueryRefs", undefined, () => validateQueryRefs(features));
  for (const feature of features) {
    // Without a unique API map the matching would report every API as missing.
    const apis = built.exposedApis;
    if (apis !== undefined) {
      report.check("validateApiExposureMatching", feature.name, () =>
        validateApiExposureMatching(feature, apis, featureMap),
      );
    }
    runFeatureChecks(report, STRUCTURE_FEATURE_CHECKS, feature, ctx);
  }
  report.endPhase();
  return built.detailForScreens ?? new Map();
}

const FEATURE_CHECKS: readonly FeatureCheck[] = [
  { check: "validateSearchableFieldReadAccess", run: (f) => validateSearchableFieldReadAccess(f) },
  { check: "validatePiiAndRetention", run: (f) => validatePiiAndRetention(f) },
  { check: "validateRecordOwnedSubjects", run: (f) => validateRecordOwnedSubjects(f) },
  { check: "validateEntitySelectOptionsQuery", run: (f) => validateEntitySelectOptionsQuery(f) },
  {
    check: "validateEntitySelectAvailabilityQuery",
    run: (f, c) => validateEntitySelectAvailabilityQuery(f, c.queryHandlerQns),
  },
  {
    check: "validateEntitySelectConditionalOptions",
    run: (f) => validateEntitySelectConditionalOptions(f),
  },
  {
    check: "validateEmbeddedFields",
    run: (f, c) => validateEmbeddedFields(f, c.featureMap, c.queryHandlerQns),
  },
  { check: "validateMultiSelectFields", run: (f) => validateMultiSelectFields(f) },
  { check: "validateImageVariants", run: (f) => validateImageVariants(f) },
  {
    check: "validateHandlerFieldReferences",
    run: (f, c) => validateHandlerFieldReferences(f, c.featureMap),
  },
  { check: "validateTransitions", run: (f) => validateTransitions(f) },
  { check: "validateLockedWhen", run: (f) => validateLockedWhen(f) },
  { check: "validateFieldConditions", run: (f) => validateFieldConditions(f) },
  { check: "validateExtendSchemaCollisions", run: (f) => validateExtendSchemaCollisions(f) },
  { check: "validateDerivedFieldCollisions", run: (f) => validateDerivedFieldCollisions(f) },
  { check: "validateHandlerAccess", run: (f) => validateHandlerAccess(f) },
  { check: "validateAccessDeclarations", run: (f) => validateAccessDeclarations(f) },
  { check: "validateLocatedTimestamps", run: (f) => validateLocatedTimestamps(f) },
  { check: "validateEntityIndexes", run: (f) => validateEntityIndexes(f) },
  { check: "validateConfigKeyBounds", run: (f) => validateConfigKeyBounds(f) },
  { check: "validateConfigKeyRequired", run: (f) => validateConfigKeyRequired(f) },
  { check: "validateConfigKeyComputed", run: (f) => validateConfigKeyComputed(f) },
  { check: "validateConfigKeyAllowPerRequest", run: (f) => validateConfigKeyAllowPerRequest(f) },
  { check: "validateConfigKeyBacking", run: (f) => validateConfigKeyBacking(f) },
  { check: "validateConfigKeyOptionsQuery", run: (f) => validateConfigKeyOptionsQuery(f) },
  { check: "validateConfigKeyPiiEncrypted", run: (f) => validateConfigKeyPiiEncrypted(f) },
  {
    check: "validateOwnershipRules",
    run: (f, c) => validateOwnershipRules(f, c.allClaimKeys, c.knownRoles),
  },
  { check: "validateReadGates", run: (f, c) => validateReadGates(f, c.featureMap) },
  { check: "validateTransferGraph", run: (f, c) => validateTransferGraph(f, c.featureMap) },
  { check: "validateMultiStreamProjections", run: (f) => validateMultiStreamProjections(f) },
];

function validateScreensOfFeature(
  feature: FeatureDefinition,
  ctx: BootContext,
  detailForScreens: DetailForScreens,
): void {
  validateScreens(
    feature,
    ctx.featureMap,
    ctx.allWriteHandlerQns,
    ctx.allScreenQns,
    ctx.configKeyDefsByQn,
    ctx.screensByShortId,
    detailForScreens,
  );
}

// validateScreens flags a Function-valued visible/entityId as "unknown field
// undefined" before the clear wiring message could surface, so a wiring
// violation in a feature suppresses its screens check.
function runWiringAndScreens(
  report: BootReport,
  feature: FeatureDefinition,
  ctx: BootContext,
  detailForScreens: DetailForScreens,
): void {
  const actionWiringOk = report.check("validateActionWiring", feature.name, () =>
    validateActionWiring(feature),
  );
  const fieldWiringOk = report.check("validateFieldWiring", feature.name, () =>
    validateFieldWiring(feature),
  );
  if (actionWiringOk && fieldWiringOk) {
    report.check("validateScreens", feature.name, () =>
      validateScreensOfFeature(feature, ctx, detailForScreens),
    );
  }
  report.check("validateNavs", feature.name, () =>
    validateNavs(feature, ctx.allScreenQns, ctx.allNavQns, ctx.allWorkspaceQns),
  );
  report.check("validateWorkspaces", feature.name, () =>
    validateWorkspaces(feature, ctx.allNavQns),
  );
}

export function runFeaturePhase(
  report: BootReport,
  ctx: BootContext,
  detailForScreens: DetailForScreens,
): FeatureFlags {
  const flags: FeatureFlags = { hasEncryptedFields: false, hasFileFields: false };
  for (const feature of ctx.features) {
    report.check("validateEncryptedFields", feature.name, () => {
      if (validateEncryptedFields(feature)) flags.hasEncryptedFields = true;
    });
    report.check("validateFileFields", feature.name, () => {
      if (validateFileFields(feature)) flags.hasFileFields = true;
    });
    runFeatureChecks(report, FEATURE_CHECKS, feature, ctx);
    runWiringAndScreens(report, feature, ctx, detailForScreens);
  }
  return flags;
}
