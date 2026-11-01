import { bootRuleError } from "@cosmicdrift/kumiko-framework/engine";
import { BILLING_FOUNDATION_BOOT_RULES } from "./boot-rules.ts";
// Feature-definition-time validation for createBillingFoundationFeature's
// options — split out of feature.ts to keep that file at registration-only
// concerns (app-feature-structure guard's 300-line budget). Internal — not
// re-exported from index.ts.

import * as z from "zod";
import {
  type BillingFoundationOptions,
  type BillingPlanContactCard,
  type ConsumerProtectionOptions,
  isLegalLinkSet,
  type LegalLinkSet,
} from "./types.ts";
import { isTerminationScope, TERMINATION_SCOPES } from "./web/constants.ts";
import { CONSENT_LOCALES, type ConsentLocale } from "./web/consumer-protection/consent-locale.ts";
import { isContactCardHref } from "./web/contact-card.ts";

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

function validateProviderTexts(cp: ConsumerProtectionOptions): void {
  for (const [providerName, texts] of Object.entries(cp.providerTexts ?? {})) {
    for (const [textName, text] of [
      ["vatNote", texts.vatNote],
      ["checkoutNote", texts.checkoutNote],
    ] as const) {
      if (text === undefined) continue;
      for (const locale of ["de", "en"] as const) {
        if (!text[locale]?.trim()) {
          throw bootRuleError(BILLING_FOUNDATION_BOOT_RULES.consumerProtectionInvalid, {
            message: `createBillingFoundationFeature: consumerProtection.providerTexts.${providerName}.${textName} needs a non-empty "${locale}" entry.`,
          });
        }
      }
    }
  }
}

function validateConsumerProtection(cp: ConsumerProtectionOptions): void {
  if (cp.termsTextBlock.trim() === "") {
    throw bootRuleError(BILLING_FOUNDATION_BOOT_RULES.consumerProtectionInvalid, {
      message: "createBillingFoundationFeature: consumerProtection.termsTextBlock is empty.",
    });
  }
  for (const locale of ["de", "en"] as const) {
    if (!cp.vatNote[locale]?.trim()) {
      throw bootRuleError(BILLING_FOUNDATION_BOOT_RULES.consumerProtectionInvalid, {
        message: `createBillingFoundationFeature: consumerProtection.vatNote needs a non-empty "${locale}" entry.`,
      });
    }
  }
  validateProviderTexts(cp);
  if (!z.email().safeParse(cp.operatorEmail).success) {
    throw bootRuleError(BILLING_FOUNDATION_BOOT_RULES.consumerProtectionInvalid, {
      message: `createBillingFoundationFeature: consumerProtection.operatorEmail "${cp.operatorEmail}" is not a valid email address.`,
    });
  }
  if (cp.oneOffItemLabel !== undefined && typeof cp.oneOffItemLabel !== "function") {
    throw bootRuleError(BILLING_FOUNDATION_BOOT_RULES.consumerProtectionInvalid, {
      message:
        "createBillingFoundationFeature: consumerProtection.oneOffItemLabel must be a function.",
    });
  }
  if (cp.terminationScope !== undefined && !isTerminationScope(cp.terminationScope)) {
    throw bootRuleError(BILLING_FOUNDATION_BOOT_RULES.consumerProtectionInvalid, {
      message: `createBillingFoundationFeature: consumerProtection.terminationScope "${String(cp.terminationScope)}" must be one of ${TERMINATION_SCOPES.map((scope) => `"${scope}"`).join(", ")}.`,
    });
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
      throw bootRuleError(BILLING_FOUNDATION_BOOT_RULES.consumerProtectionInvalid, {
        message: `createBillingFoundationFeature: consumerProtection.legalLinks needs a "${locale}" entry when given per locale.`,
      });
    }
    validateLegalLinkSet(set, `legalLinks.${locale}`);
  }
}

function validateLegalLinkSet(set: LegalLinkSet, path: string): void {
  for (const [key, link] of Object.entries(set)) {
    // skip: refund is optional
    if (key === "refund" && link === undefined) continue;
    if (typeof link !== "string" || !isRootRelativeOrHttpsUrl(link)) {
      throw bootRuleError(BILLING_FOUNDATION_BOOT_RULES.consumerProtectionInvalid, {
        message: `createBillingFoundationFeature: consumerProtection.${path}.${key} "${link}" must be a root-relative path ("/..." not "//") or an absolute https URL.`,
      });
    }
  }
}

function validateContactCard(contact: BillingPlanContactCard): void {
  for (const key of ["labelKey", "actionLabelKey"] as const) {
    if (contact[key].trim() === "") {
      throw bootRuleError(BILLING_FOUNDATION_BOOT_RULES.catalogInvalid, {
        message: `createBillingFoundationFeature: catalog.contact.${key} must not be empty.`,
      });
    }
  }
  if (!isContactCardHref(contact.href)) {
    throw bootRuleError(BILLING_FOUNDATION_BOOT_RULES.catalogInvalid, {
      message: `createBillingFoundationFeature: catalog.contact.href "${contact.href}" must be an absolute https: or mailto: URL.`,
    });
  }
}

function validateBaseUrl(baseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw bootRuleError(BILLING_FOUNDATION_BOOT_RULES.baseUrlInvalid, {
      message: `createBillingFoundationFeature: baseUrl "${baseUrl}" is not a parseable absolute URL.`,
    });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw bootRuleError(BILLING_FOUNDATION_BOOT_RULES.baseUrlInvalid, {
      message: `createBillingFoundationFeature: baseUrl "${baseUrl}" must use http or https (parsed protocol "${parsed.protocol}").`,
    });
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
      throw bootRuleError(BILLING_FOUNDATION_BOOT_RULES.baseUrlRequired, {
        message:
          "createBillingFoundationFeature: consumerProtection requires baseUrl (checkout redirect URLs are built from it).",
      });
    }
    validateConsumerProtection(options.consumerProtection);
  }
  const { catalog } = options;
  // skip: no catalog configured, nothing more to validate.
  if (!catalog) return;
  if (options.baseUrl === undefined) {
    throw bootRuleError(BILLING_FOUNDATION_BOOT_RULES.baseUrlRequired, {
      message:
        "createBillingFoundationFeature: catalog requires baseUrl (plan checkouts need it to build success/cancel/return URLs).",
    });
  }
  if (catalog.plans.length === 0) {
    throw bootRuleError(BILLING_FOUNDATION_BOOT_RULES.catalogInvalid, {
      message: "createBillingFoundationFeature: catalog.plans must not be empty.",
    });
  }
  const seen = new Set<string>();
  for (const tier of catalog.plans) {
    if (seen.has(tier)) {
      throw bootRuleError(BILLING_FOUNDATION_BOOT_RULES.catalogInvalid, {
        message: `createBillingFoundationFeature: catalog.plans has a duplicate tier "${tier}".`,
      });
    }
    seen.add(tier);
  }
  for (const [key, path] of [
    ["successPath", catalog.successPath],
    ["cancelPath", catalog.cancelPath],
    ["returnPath", catalog.returnPath],
  ] as const) {
    if (path !== undefined && !isRootRelativePath(path)) {
      throw bootRuleError(BILLING_FOUNDATION_BOOT_RULES.catalogInvalid, {
        message: `createBillingFoundationFeature: catalog.${key} "${path}" must start with "/" and not "//".`,
      });
    }
  }
  if (catalog.viewRoles.length === 0) {
    throw bootRuleError(BILLING_FOUNDATION_BOOT_RULES.catalogInvalid, {
      message: "createBillingFoundationFeature: catalog.viewRoles must not be empty.",
    });
  }
  if (catalog.contact !== undefined) validateContactCard(catalog.contact);
}
