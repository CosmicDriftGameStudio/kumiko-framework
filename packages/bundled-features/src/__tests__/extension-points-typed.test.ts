// Ratchet: every extension point a bundled feature declares via
// `r.extendsRegistrar` and whose options are actually read somewhere must be
// entered into `KumikoExtensionOptionsMap` — see extension-options-map.ts.
// New points either join TYPED_EXTENSION_POINTS (with the map augmentation)
// or UNTYPED_BY_DESIGN (with a reason). Anything else fails this test.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { KumikoExtensionOptionsMap } from "@cosmicdrift/kumiko-types/extension-options-map";
import { authFoundationFeature } from "../auth-foundation/feature";
import { billingFoundationFeature } from "../billing-foundation/feature";
import { createCustomFieldsFeature } from "../custom-fields/feature";
import { createDeliveryFeature } from "../delivery/feature";
import { documentIngestFoundationFeature } from "../document-ingest-foundation/feature";
import { createFileDerivativesFeature } from "../file-derivatives/feature";
import { fileFoundationFeature } from "../file-foundation/feature";
import { inboundMailFoundationFeature } from "../inbound-mail-foundation/feature";
import { mailFoundationFeature } from "../mail-foundation/feature";
import { createRendererFoundationFeature } from "../renderer-foundation/feature";
import { createTenantHandoverFeature } from "../tenant-handover/feature";
import { createTenantLifecycleFeature } from "../tenant-lifecycle/feature";
import { createTierEngineFeature } from "../tier-engine/feature";
import { createUserFeature } from "../user/feature";
import { createUserDataRightsFeature } from "../user-data-rights/feature";

const TYPED_EXTENSION_POINTS = [
  "userData",
  "tenantData",
  "storageProvider",
  "searchAdapter",
  "externalResource",
  "infraResource",
  "fileProvider",
  "derivativeRenderer",
  "derivativeOverlayResolver",
  "derivativePublicPredicate",
  "principalStatus",
  "tenantLifecycleStatus",
  "tenantTierResolver",
  "tokenVerifier",
  "sessionStore",
  "tenantResolver",
  "tenantExistence",
  "inboundMailProvider",
  "renderer",
  "deliveryChannel",
  "subscriptionProvider",
  "mailTransport",
  "documentIngestProvider",
  "signupHandover",
] as const satisfies readonly (keyof KumikoExtensionOptionsMap)[];

const UNTYPED_BY_DESIGN: Record<string, string> = {
  customFields: "opt-in marker only — registered options are never read",
};

// Owner-directories that declare at least one extension point via
// `r.extendsRegistrar` — one entry per feature composed in
// allRegistrarExtensionNames() below. Catches a new feature that starts
// calling r.extendsRegistrar without being added to that composition list.
const DECLARING_FEATURE_DIRS = [
  "auth-foundation",
  "billing-foundation",
  "custom-fields",
  "delivery",
  "document-ingest-foundation",
  "file-derivatives",
  "file-foundation",
  "inbound-mail-foundation",
  "mail-foundation",
  "renderer-foundation",
  "tenant-handover",
  "tenant-lifecycle",
  "tier-engine",
  "user",
  "user-data-rights",
].sort();

// Scans bundled-features source (excluding tests) for real `r.extendsRegistrar(`
// call sites, ignoring occurrences inside line comments (e.g. a doc-comment
// mentioning the call). Returns the sorted, deduped set of owning top-level
// directories under packages/bundled-features/src.
function scanExtendsRegistrarOwnerDirs(): readonly string[] {
  const srcDir = new URL("..", import.meta.url).pathname;
  const glob = new Bun.Glob("**/*.ts");
  const owners = new Set<string>();
  for (const relPath of glob.scanSync({ cwd: srcDir, onlyFiles: true })) {
    if (relPath.includes("__tests__/") || relPath.endsWith(".test.ts")) continue;
    const contents = readFileSync(`${srcDir}${relPath}`, "utf8");
    const hasRealCall = contents
      .split("\n")
      .some((line) => line.split("//")[0]?.includes("r.extendsRegistrar("));
    if (!hasRealCall) continue;
    const topLevelDir = relPath.split("/")[0];
    if (topLevelDir) owners.add(topLevelDir);
  }
  return [...owners].sort();
}

function allRegistrarExtensionNames(): readonly string[] {
  const features = [
    authFoundationFeature,
    billingFoundationFeature,
    createCustomFieldsFeature(),
    createDeliveryFeature(),
    documentIngestFoundationFeature,
    createFileDerivativesFeature(),
    fileFoundationFeature,
    inboundMailFoundationFeature,
    mailFoundationFeature,
    createRendererFoundationFeature(),
    createTenantHandoverFeature({ grantSecret: "test-secret-min-32-chars-long-enough" }),
    createTenantLifecycleFeature(),
    createTierEngineFeature(),
    createUserFeature(),
    createUserDataRightsFeature(),
  ];
  const names = new Set<string>();
  for (const feature of features) {
    for (const name of Object.keys(feature.registrarExtensions)) {
      names.add(name);
    }
  }
  return [...names];
}

describe("extension-points-typed ratchet", () => {
  test("every declared extension point is either typed or explicitly untyped-by-design", () => {
    const declared = allRegistrarExtensionNames();
    const known = new Set<string>([...TYPED_EXTENSION_POINTS, ...Object.keys(UNTYPED_BY_DESIGN)]);
    const unaccounted = declared.filter((name) => !known.has(name));
    expect(unaccounted).toEqual([]);
  });

  test("TYPED_EXTENSION_POINTS and UNTYPED_BY_DESIGN don't overlap", () => {
    const overlap = TYPED_EXTENSION_POINTS.filter((name) => name in UNTYPED_BY_DESIGN);
    expect(overlap).toEqual([]);
  });

  test("every directory that calls r.extendsRegistrar is composed into allRegistrarExtensionNames", () => {
    expect(scanExtendsRegistrarOwnerDirs()).toEqual(DECLARING_FEATURE_DIRS);
  });
});
