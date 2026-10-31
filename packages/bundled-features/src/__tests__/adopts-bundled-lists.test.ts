import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { createAuditFeature } from "../audit/index.ts";
import { createCapCounterFeature } from "../cap-counter/index.ts";
import { createCapOverviewFeature } from "../cap-overview/index.ts";
import { createContactFeature } from "../contact/index.ts";
import { createDeliveryFeature } from "../delivery/index.ts";
import { createDocumentsFeature } from "../documents/index.ts";
import { createFeatureTogglesFeature } from "../feature-toggles/index.ts";
import { createInboundMailFoundationFeature } from "../inbound-mail-foundation/index.ts";
import { createJobsFeature } from "../jobs/index.ts";
import { createManagedPagesFeature } from "../managed-pages/index.ts";
import { createPersonalAccessTokensFeature } from "../personal-access-tokens/index.ts";
import { createReadinessFeature } from "../readiness/index.ts";
import { createSessionsFeature } from "../sessions/index.ts";
import { createTagsFeature } from "../tags/index.ts";
import { createTenantFeature } from "../tenant/index.ts";
import { createUserFeature } from "../user/index.ts";
import { createUserDataRightsFeature } from "../user-data-rights/index.ts";
import { createWaitlistFeature } from "../waitlist/index.ts";

const SRC_DIR = join(import.meta.dir, "..");
const NON_FEATURE_DIRS = new Set(["shared", "presets", "__tests__"]);
const LIST_SCREEN_PATTERN = /\btype: "(entityList|projectionList)"|\bkind: "relatedList"/;
const ADOPTS_CALL_PATTERN = /\br\.adoptsBundledLists\(\)/;

// For bundled features the directory name is the feature directory; the value builds its feature.
const ADOPTING_FEATURES: Readonly<Record<string, () => FeatureDefinition>> = {
  audit: () => createAuditFeature(),
  "cap-counter": () => createCapCounterFeature(),
  "cap-overview": () =>
    createCapOverviewFeature({
      caps: [{ id: "widgets", label: "test.cap.widgets", limit: () => 5, usage: async () => 0 }],
    }),
  contact: () => createContactFeature({ appName: "Acme" }),
  delivery: () => createDeliveryFeature(),
  documents: () => createDocumentsFeature({ categories: ["contract"], linkTargets: ["property"] }),
  "feature-toggles": () => createFeatureTogglesFeature(),
  "inbound-mail-foundation": () => createInboundMailFoundationFeature(),
  jobs: () => createJobsFeature(),
  "managed-pages": () => createManagedPagesFeature({ resolveApexTenant: () => null }),
  "personal-access-tokens": () => createPersonalAccessTokensFeature({ scopes: {} }),
  readiness: () => createReadinessFeature(),
  sessions: () => createSessionsFeature(),
  tags: () => createTagsFeature(),
  tenant: () => createTenantFeature(),
  user: () => createUserFeature(),
  "user-data-rights": () => createUserDataRightsFeature(),
  waitlist: () => createWaitlistFeature(),
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

function directoriesWhereSourceMatches(pattern: RegExp): string[] {
  return readdirSync(SRC_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !NON_FEATURE_DIRS.has(entry.name))
    .filter((entry) =>
      sourceFiles(join(SRC_DIR, entry.name)).some((file) =>
        pattern.test(readFileSync(file, "utf8")),
      ),
    )
    .map((entry) => entry.name)
    .sort();
}

describe("r.adoptsBundledLists in bundled features", () => {
  test("exactly the features that ship list screens call it", () => {
    expect(directoriesWhereSourceMatches(ADOPTS_CALL_PATTERN)).toEqual(
      directoriesWhereSourceMatches(LIST_SCREEN_PATTERN),
    );
  });

  test("the built features of those directories carry the marker", () => {
    expect(Object.keys(ADOPTING_FEATURES).sort()).toEqual(
      directoriesWhereSourceMatches(LIST_SCREEN_PATTERN),
    );
    for (const [directory, build] of Object.entries(ADOPTING_FEATURES)) {
      expect({ directory, adopts: build().adoptsBundledLists }).toEqual({
        directory,
        adopts: true,
      });
    }
  });
});
