import { MAIL_TRANSPORT_EXTENSION } from "@cosmicdrift/kumiko-bundled-features/mail-foundation";
import {
  bootRuleError,
  collectBootRuleViolations,
  EXT_USER_DATA,
  type FeatureDefinition,
  type ResolvedPiiFlags,
} from "@cosmicdrift/kumiko-framework/engine";
import { DELIVERY_CHANNEL_EXTENSION, EMAIL_CHANNEL_NAME } from "../delivery/index.ts";
import { entitiesOf } from "../shared/index.ts";
import { USER_DATA_RIGHTS_BOOT_RULES } from "./boot-rules.ts";
import type { UserDataRightsOptions } from "./options.ts";

// Same mail paths the default mailers probe on the registry at send time.
function isGdprMailPathMounted(features: readonly FeatureDefinition[]): boolean {
  return features.some((feature) =>
    feature.extensionUsages.some(
      (usage) =>
        (usage.extensionName === DELIVERY_CHANNEL_EXTENSION &&
          usage.entityName === EMAIL_CHANNEL_NAME) ||
        usage.extensionName === MAIL_TRANSPORT_EXTENSION,
    ),
  );
}

function sendsAnyDefaultGdprMail(opts: UserDataRightsOptions): boolean {
  const anonymousDeletionFlow =
    opts.deletionTokenSecret !== undefined && opts.deletionVerifyUrl !== undefined;
  return (
    anonymousDeletionFlow ||
    opts.sendExportReadyEmail === undefined ||
    opts.sendExportFailedEmail === undefined ||
    opts.sendDeletionRequestedEmail === undefined ||
    opts.sendDeletionExecutedEmail === undefined
  );
}

// Without an app name the default mails went out as "Account — ...", which reads
// like phishing; a boot error is cheaper than that mail in a user's inbox.
export function validateGdprMailAppName(
  features: readonly FeatureDefinition[],
  opts: UserDataRightsOptions,
): void {
  if (opts.mailDefaults !== undefined) return;
  if (!sendsAnyDefaultGdprMail(opts) || !isGdprMailPathMounted(features)) return;
  throw bootRuleError(USER_DATA_RIGHTS_BOOT_RULES.mailAppNameMissing, {
    message:
      '[kumiko:boot] user-data-rights sends its default GDPR mails (a mail channel or transport is mounted and not every send*Email callback is set) but has no app name for them. Pass createUserDataRightsFeature({ mailDefaults: { appName: "<your app>" } }) so subject and body name the app.',
  });
}

// V2: export-without-erase gate. A feature that registers an EXT_USER_DATA
// export hook without a matching delete hook exports data under Art.20 but
// never erases it on forget — an Art.17 violation. Hard boot failure: no app
// should ship a GDPR export path with no erase path. Registry-level signal
// only; runtime no-ops (a delete hook that silently skips) are not detectable
// here — those are covered by the export/forget integration tests.
//
// Registered as an `r.bootCheck()` by this feature: EXT_USER_DATA is
// framework-owned, so hooks may exist without user-data-rights, but they only
// run (and therefore only need to be complete) when this feature is mounted.
export function validateGdprHookCompleteness(features: readonly FeatureDefinition[]): void {
  const usages = features.flatMap((feature) =>
    feature.extensionUsages
      .filter((usage) => usage.extensionName === EXT_USER_DATA)
      .map((usage) => ({ feature, usage })),
  );
  collectBootRuleViolations(usages, ({ feature, usage }) => {
    const hasExport = typeof usage.options?.["export"] === "function";
    const hasDelete = typeof usage.options?.["delete"] === "function";
    // The compile-time "at least one hook" type is bypassed by string-typed
    // extension names and casts; without this an empty bag registers nothing.
    if (!hasExport && !hasDelete) {
      throw bootRuleError(USER_DATA_RIGHTS_BOOT_RULES.emptyHook, {
        message: `[kumiko:boot] Feature "${feature.name}" registers EXT_USER_DATA for entity "${usage.entityName}" with neither an export nor a delete hook — the entity silently stays out of the Art.15/17/20 pipeline. Register at least one hook.`,
      });
    }
    if (hasExport && !hasDelete) {
      throw bootRuleError(USER_DATA_RIGHTS_BOOT_RULES.exportWithoutDelete, {
        message: `[kumiko:boot] Feature "${feature.name}" exports entity "${usage.entityName}" via EXT_USER_DATA but registers no delete hook — data is included in Art.20 exports but never erased on forget (Art.17 violation). Add a delete hook. If erasure is intentionally handled elsewhere (e.g. crypto-shredding key-erase, parent cascade), register a no-op delete: async () => {} with a comment explaining why.`,
      });
    }
  });
}

// V3: PII-entity-without-hook gate. V2 checks registered hooks for
// completeness; V3 catches the entity nobody registered at all — fields
// annotated as user-subject data (pii / userOwned / subjectRef) yet
// invisible to the Art.15/20 export and Art.17 forget pipeline. Hard boot
// failure: a
// subject-data entity that skips the pipeline is exactly the "feature built
// past GDPR" leak this gate exists to stop. No "is user-data-rights mounted"
// guard needed here (unlike the framework-internal predecessor) — this runs
// as user-data-rights' own bootCheck, so it's only reachable when mounted.
// Matching is by entity name across all features (usage.entityName is
// unqualified); a same-named entity in another feature can mask a gap —
// accepted, as the common case is a distinct entity name.
export function validateGdprPiiHookCoverage(features: readonly FeatureDefinition[]): void {
  const hookedEntities = new Set<string>();
  for (const f of features) {
    for (const usage of f.extensionUsages) {
      if (usage.extensionName === EXT_USER_DATA) hookedEntities.add(usage.entityName);
    }
  }

  const entities = features.flatMap((feature) =>
    [...entitiesOf(feature)].map(([entityName, entity]) => ({ feature, entityName, entity })),
  );
  collectBootRuleViolations(entities, ({ feature, entityName, entity }) => {
    // skip: an entity with a registered hook is covered
    if (hookedEntities.has(entityName)) return;
    const subjectFields = Object.entries(entity.fields)
      .filter(([, field]) => {
        const annot = field as ResolvedPiiFlags; // @cast-boundary schema-walk
        return Boolean(annot.pii) || Boolean(annot.userOwned) || Boolean(annot.subjectRef);
      })
      .map(([name]) => name);
    // skip: an entity without user-subject fields stays out of the pipeline by design
    if (subjectFields.length === 0) return;
    throw bootRuleError(USER_DATA_RIGHTS_BOOT_RULES.missingHook, {
      message: `[kumiko:boot] Entity "${entityName}" (feature "${feature.name}") has user-subject fields (${subjectFields.join(", ")}) but no feature registers an EXT_USER_DATA hook for it — the data never appears in Art.15/20 exports and is never erased on forget (Art.17 gap). Register r.applyExtension({ name: EXT_USER_DATA, entity: "${entityName}", export, delete }) in the owning feature or a defaults feature. If this entity is intentionally out of the pipeline (e.g. crypto-shredding key-erase covers it), register a no-op hook { export: async () => null, delete: async () => {} } with a comment explaining why.`,
    });
  });
}
