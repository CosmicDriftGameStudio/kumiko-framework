// Feature-definition-time validation for createBillingFoundationFeature's
// options — split out of feature.ts to keep that file at registration-only
// concerns (app-feature-structure guard's 300-line budget). Internal — not
// re-exported from index.ts.

import type { BillingFoundationOptions } from "./types";

function isRootRelativePath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//");
}

/** Validates `options` and throws a plain `Error` with a clear message at
 *  feature-definition time — same pattern as `createCapOverviewFeature`.
 *  `createBillingFoundationFeature()` (no options) always succeeds; the
 *  extra checks only fire once a caller opts into `baseUrl`/`catalog`. */
export function validateOptions(options: BillingFoundationOptions): void {
  if (options.baseUrl !== undefined) {
    let parsed: URL;
    try {
      parsed = new URL(options.baseUrl);
    } catch {
      throw new Error(
        `createBillingFoundationFeature: baseUrl "${options.baseUrl}" is not a parseable absolute URL.`,
      );
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(
        `createBillingFoundationFeature: baseUrl "${options.baseUrl}" must use http or https (parsed protocol "${parsed.protocol}").`,
      );
    }
  }
  const { catalog } = options;
  // skip: no catalog configured, nothing more to validate.
  if (!catalog) return;
  if (options.baseUrl === undefined) {
    throw new Error(
      "createBillingFoundationFeature: catalog requires baseUrl (plan checkouts need it to build success/cancel/return URLs).",
    );
  }
  if (catalog.plans.length === 0) {
    throw new Error("createBillingFoundationFeature: catalog.plans must not be empty.");
  }
  const seen = new Set<string>();
  for (const tier of catalog.plans) {
    if (seen.has(tier)) {
      throw new Error(
        `createBillingFoundationFeature: catalog.plans has a duplicate tier "${tier}".`,
      );
    }
    seen.add(tier);
  }
  for (const [key, path] of [
    ["successPath", catalog.successPath],
    ["cancelPath", catalog.cancelPath],
    ["returnPath", catalog.returnPath],
  ] as const) {
    if (path !== undefined && !isRootRelativePath(path)) {
      throw new Error(
        `createBillingFoundationFeature: catalog.${key} "${path}" must start with "/" and not "//".`,
      );
    }
  }
  if (catalog.viewRoles.length === 0) {
    throw new Error("createBillingFoundationFeature: catalog.viewRoles must not be empty.");
  }
}
