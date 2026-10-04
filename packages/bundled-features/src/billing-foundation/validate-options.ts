// Feature-definition-time validation for createBillingFoundationFeature's
// options — split out of feature.ts to keep that file at registration-only
// concerns (app-feature-structure guard's 300-line budget). Internal — not
// re-exported from index.ts.

import * as z from "zod";
import { isTerminationScope, TERMINATION_SCOPES } from "./constants.js";
import { CONSENT_LOCALES, type ConsentLocale } from "./consumer-protection/consent-locale.js";
import {
  type BillingFoundationOptions,
  type ConsumerProtectionOptions,
  isLegalLinkSet,
  type LegalLinkSet,
} from "./types.js";

function isRootRelativePath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//");
}

function isRootRelativeOrHttpsUrl(link: string): boolean {
  if (isRootRelativePath(link)) return true;
  try {
    return new URL(link).protocol === "https:";
  } catch {
    return false;
  }
}

function validateConsumerProtection(cp: ConsumerProtectionOptions): void {
  if (cp.termsTextBlock.trim() === "") {
    throw new Error("createBillingFoundationFeature: consumerProtection.termsTextBlock is empty.");
  }
  for (const locale of ["de", "en"] as const) {
    if (!cp.vatNote[locale]?.trim()) {
      throw new Error(
        `createBillingFoundationFeature: consumerProtection.vatNote needs a non-empty "${locale}" entry.`,
      );
    }
  }
  if (!z.email().safeParse(cp.operatorEmail).success) {
    throw new Error(
      `createBillingFoundationFeature: consumerProtection.operatorEmail "${cp.operatorEmail}" is not a valid email address.`,
    );
  }
  if (cp.oneOffItemLabel !== undefined && typeof cp.oneOffItemLabel !== "function") {
    throw new Error(
      "createBillingFoundationFeature: consumerProtection.oneOffItemLabel must be a function.",
    );
  }
  if (cp.terminationScope !== undefined && !isTerminationScope(cp.terminationScope)) {
    throw new Error(
      `createBillingFoundationFeature: consumerProtection.terminationScope "${String(cp.terminationScope)}" must be one of ${TERMINATION_SCOPES.map((scope) => `"${scope}"`).join(", ")}.`,
    );
  }
  if (isLegalLinkSet(cp.legalLinks)) {
    validateLegalLinkSet(cp.legalLinks, "legalLinks");
  } else {
    validatePerLocaleLegalLinks(cp.legalLinks);
  }
}

function validatePerLocaleLegalLinks(
  legalLinks: Readonly<Record<ConsentLocale, LegalLinkSet>>,
): void {
  for (const locale of CONSENT_LOCALES) {
    const set = legalLinks[locale];
    if (!set) {
      throw new Error(
        `createBillingFoundationFeature: consumerProtection.legalLinks needs a "${locale}" entry when given per locale.`,
      );
    }
    validateLegalLinkSet(set, `legalLinks.${locale}`);
  }
}

function validateLegalLinkSet(set: LegalLinkSet, path: string): void {
  for (const [key, link] of Object.entries(set)) {
    if (!isRootRelativeOrHttpsUrl(link)) {
      throw new Error(
        `createBillingFoundationFeature: consumerProtection.${path}.${key} "${link}" must be a root-relative path ("/..." not "//") or an absolute https URL.`,
      );
    }
  }
}

function validateBaseUrl(baseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(
      `createBillingFoundationFeature: baseUrl "${baseUrl}" is not a parseable absolute URL.`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `createBillingFoundationFeature: baseUrl "${baseUrl}" must use http or https (parsed protocol "${parsed.protocol}").`,
    );
  }
}

/** Validates `options` and throws a plain `Error` with a clear message at
 *  feature-definition time — same pattern as `createCapOverviewFeature`.
 *  `createBillingFoundationFeature()` (no options) always succeeds; the
 *  extra checks only fire once a caller opts into `baseUrl`/`catalog`. */
export function validateOptions(options: BillingFoundationOptions): void {
  if (options.baseUrl !== undefined) validateBaseUrl(options.baseUrl);
  if (options.consumerProtection) {
    if (options.baseUrl === undefined) {
      throw new Error(
        "createBillingFoundationFeature: consumerProtection requires baseUrl (checkout redirect URLs are built from it).",
      );
    }
    validateConsumerProtection(options.consumerProtection);
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
