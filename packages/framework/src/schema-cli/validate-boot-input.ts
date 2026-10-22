import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import type { ValidateBootOptions } from "../engine/boot-validator.ts";
import {
  FILE_STORAGE_PROVIDER_BOOT_SENTINEL,
  FILE_STORAGE_PROVIDER_ENV,
} from "../engine/extension-names.ts";
import type { FeatureDefinition } from "../engine/types/feature.ts";

// `validate` only sees the composed FEATURES. The file provider normally comes from
// runProdApp's `fileStorage` option, which defaults FILE_STORAGE_PROVIDER at boot, so
// an unset variable here is no misconfiguration. The deploy env is checked by the real boot.
export function withFileStoragePresence(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  return env[FILE_STORAGE_PROVIDER_ENV] === undefined
    ? { ...env, [FILE_STORAGE_PROVIDER_ENV]: FILE_STORAGE_PROVIDER_BOOT_SENTINEL }
    : { ...env };
}

function isStringSet(value: unknown): value is ReadonlySet<string> {
  return value instanceof Set && [...value].every((entry) => typeof entry === "string");
}

function isNonEmptyStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry !== "");
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function validateBootOptionsError(detail: string): Error {
  return new Error(`kumiko/schema.ts: \`VALIDATE_BOOT_OPTIONS\` ${detail}`);
}

function readOptionalOption<T>(
  raw: object,
  key: string,
  isValid: (value: unknown) => value is T,
  expected: string,
): T | undefined {
  const value: unknown = Reflect.get(raw, key);
  if (value === undefined) return undefined;
  if (!isValid(value)) throw validateBootOptionsError(`\`${key}\` must be ${expected}.`);
  return value;
}

// Boundary check for `export const VALIDATE_BOOT_OPTIONS` in kumiko/schema.ts.
// Only the options that change what validateBoot reports are honoured; `env` and
// `entityFieldCipher` are runner-injected and deliberately ignored here.
export function parseValidateBootOptions(raw: unknown): ValidateBootOptions {
  if (raw === undefined) return {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw validateBootOptionsError("must be an object (ValidateBootOptions).");
  }
  const navAllowlist = readOptionalOption(raw, "navAllowlist", isStringSet, "a Set<string>");
  const navAllowlistExempt = readOptionalOption(
    raw,
    "navAllowlistExempt",
    isStringSet,
    "a Set<string>",
  );
  const warnOnUniqueAccessRoles = readOptionalOption(
    raw,
    "warnOnUniqueAccessRoles",
    isBoolean,
    "a boolean",
  );
  const requiredLocales = readOptionalOption(
    raw,
    "requiredLocales",
    isNonEmptyStringArray,
    "an array of non-empty strings",
  );
  return {
    ...(requiredLocales !== undefined && { requiredLocales }),
    ...(navAllowlist !== undefined && { navAllowlist }),
    ...(navAllowlistExempt !== undefined && { navAllowlistExempt }),
    ...(warnOnUniqueAccessRoles !== undefined && { warnOnUniqueAccessRoles }),
  };
}

// Every non-optional top-level property of FeatureDefinition, grouped by the runtime shape the
// boot validators rely on; a hand-built entry missing one would crash far from the cause.
const FEATURE_ARRAY_KEYS = [
  "requires",
  "optionalRequires",
  "configSeeds",
  "extensionUsages",
  "extensionSelectors",
  "bootChecks",
  "referenceData",
  "configReads",
  "authClaimsHooks",
] as const satisfies readonly (keyof FeatureDefinition)[];

const FEATURE_SET_KEYS = [
  "requiredProjections",
  "requiredSteps",
  "exposedApis",
  "usedApis",
] as const satisfies readonly (keyof FeatureDefinition)[];

const FEATURE_RECORD_KEYS = [
  "relations",
  "writeHandlers",
  "queryHandlers",
  "streamHandlers",
  "translations",
  "configKeys",
  "jobs",
  "registrarExtensions",
  "notifications",
  "events",
  "eventMigrations",
  "handlerEntityMappings",
  "metrics",
  "secretKeys",
  "secretNamespaces",
  "projections",
  "multiStreamProjections",
  "claimKeys",
  "screens",
  "navs",
  "workspaces",
  "httpRoutes",
  "webSocketRoutes",
  "storeTables",
] as const satisfies readonly (keyof FeatureDefinition)[];

function isFeatureDefinitionShape(entry: unknown): entry is FeatureDefinition {
  if (!isPlainObject(entry)) return false;
  return (
    typeof entry["name"] === "string" &&
    typeof entry["systemScope"] === "boolean" &&
    FEATURE_ARRAY_KEYS.every((key) => Array.isArray(entry[key])) &&
    FEATURE_SET_KEYS.every((key) => entry[key] instanceof Set) &&
    FEATURE_RECORD_KEYS.every((key) => isPlainObject(entry[key]))
  );
}

// FEATURES comes from the app's schema module; one malformed entry would make
// validateBoot fail with an unrelated error far from the cause, so name the index here.
export function featureDefinitionsOf(value: unknown): readonly FeatureDefinition[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const definitions: FeatureDefinition[] = [];
  for (const [index, entry] of value.entries()) {
    if (!isFeatureDefinitionShape(entry)) {
      throw new Error(
        `FEATURES[${index}] is not a FeatureDefinition (expected an object with a string \`name\`)`,
      );
    }
    definitions.push(entry);
  }
  return definitions;
}
