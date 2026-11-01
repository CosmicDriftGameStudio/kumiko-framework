// A bundled event type without a label or a technical stance would show up raw in the audit log.

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  type FeatureDefinition,
  qn,
  toKebab,
  WORKFLOW_SYSTEM_EVENT_DEFS,
} from "@cosmicdrift/kumiko-framework/engine";
import { createBillingFoundationFeature } from "../../billing-foundation/index.ts";
import { createHelpdeskFeature } from "../../helpdesk/index.ts";
import { createPersonalAccessTokensFeature } from "../../personal-access-tokens/index.ts";
import {
  AUDIT_EVENT_STANCES,
  FRAMEWORK_SYSTEM_EVENT_TYPES,
  TECHNICAL_EVENT,
} from "../event-classification.ts";
import { AUDIT_I18N } from "../web/i18n.ts";

const BUNDLED_ROOT = join(import.meta.dir, "../..");

// Factories that need options to build; the ones defining events are instantiated explicitly below.
// A new factory that throws without options fails the test until it is listed here on purpose.
const FACTORIES_NEEDING_OPTIONS: ReadonlySet<string> = new Set([
  "billing-foundation/createBillingFoundationFeature",
  "documents/createDocumentsFeature",
  "personal-access-tokens/createPersonalAccessTokensFeature",
  "channel-email/createChannelEmailFeature",
  "channel-push/createChannelPushFeature",
  "cap-overview/createCapOverviewFeature",
  "helpdesk/createHelpdeskFeature",
  "host-routing/createHostRoutingFeature",
  "auth-mfa/createAuthMfaFeature",
  "seo/createSeoFeature",
  "managed-pages/createManagedPagesFeature",
  "metrics/createMetricsFeature",
  "metrics/createSystemMetricsFeature",
  "file-provider-s3/createFileProviderS3NamedEnvFeature",
  "subscription-mollie/createSubscriptionMollieFeature",
]);

async function zeroArgBundledFeatures(): Promise<{
  readonly features: readonly FeatureDefinition[];
  readonly unbuildable: readonly string[];
}> {
  const features: FeatureDefinition[] = [];
  const unbuildable: string[] = [];
  for (const dir of readdirSync(BUNDLED_ROOT, { withFileTypes: true })) {
    const indexPath = join(BUNDLED_ROOT, dir.name, "index.ts");
    if (!dir.isDirectory() || !existsSync(indexPath)) continue;
    const exports: Record<string, unknown> = await import(indexPath);
    for (const [name, value] of Object.entries(exports)) {
      if (!/^create\w*Feature$/.test(name) || typeof value !== "function") continue;
      const id = `${dir.name}/${name}`;
      if (FACTORIES_NEEDING_OPTIONS.has(id)) continue;
      try {
        features.push(value());
      } catch {
        unbuildable.push(id);
      }
    }
  }
  return { features, unbuildable };
}

const { features: zeroArgFeatures, unbuildable } = await zeroArgBundledFeatures();

const featuresWithOptions: readonly FeatureDefinition[] = [
  createBillingFoundationFeature({
    baseUrl: "https://app.example.com",
    consumerProtection: {
      termsTextBlock: "terms",
      vatNote: { de: "inkl. USt.", en: "incl. VAT" },
      operatorEmail: "billing@example.com",
      legalLinks: { terms: "/terms", withdrawal: "/withdrawal", privacy: "/privacy" },
    },
  }),
  createPersonalAccessTokensFeature({ scopes: {} }),
  createHelpdeskFeature({ appName: "Acme" }),
];

const eventTypes: readonly string[] = [
  ...[...zeroArgFeatures, ...featuresWithOptions].flatMap((feature) =>
    Object.keys(feature.events ?? {}).map((shortName) =>
      qn(toKebab(feature.name), "event", toKebab(shortName)),
    ),
  ),
  ...WORKFLOW_SYSTEM_EVENT_DEFS.keys(),
];

describe("audit event classification", () => {
  test("every bundled factory builds without options or is listed as needing them", () => {
    expect(unbuildable).toEqual([]);
  });

  test("the scan finds the bundled events", () => {
    expect(eventTypes.length).toBeGreaterThan(40);
    expect(eventTypes).toContain("billing-foundation:event:contract-termination-revoked");
    expect(eventTypes).toContain("personal-access-tokens:event:pat-revoked");
  });

  test("every event type has an English label or a technical stance", () => {
    const unclassified = eventTypes.filter((type) => {
      if (FRAMEWORK_SYSTEM_EVENT_TYPES.includes(type)) return false;
      const stance = AUDIT_EVENT_STANCES[type];
      if (stance === undefined) return true;
      return stance !== TECHNICAL_EVENT && AUDIT_I18N[stance.labelKey] === undefined;
    });
    expect(unclassified).toEqual([]);
  });

  test("no stance points at an event type that no longer exists", () => {
    const registered = new Set(eventTypes);
    expect(Object.keys(AUDIT_EVENT_STANCES).filter((type) => !registered.has(type))).toEqual([]);
  });
});
