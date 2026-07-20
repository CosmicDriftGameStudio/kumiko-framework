// issue-1174: `bun create kumiko-app <name> --yes` resolves the recommended
// feature set through the manifest's `requires` graph (dep-resolver.ts), not
// through hand-written app composition. That graph can pull in a feature
// (here: user-data-rights, transitively via user-profile) whose boot-time
// obligations (an EXT_USER_DATA hook per PII entity) no OTHER auto-included
// feature satisfies — cli.test.ts's file-existence checks can't catch that,
// only actually booting the resolved set through validateBoot can.

import { describe, expect, test } from "bun:test";
import { createPersonalAccessTokensFeature } from "@cosmicdrift/kumiko-bundled-features/personal-access-tokens";
import {
  createRegistry,
  type FeatureDefinition,
  validateBoot as validateBootRaw,
} from "@cosmicdrift/kumiko-framework/engine";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-framework/testing";
import { composeFeatures } from "@cosmicdrift/kumiko-server-runtime/compose-features";
import { resolveDeps } from "../dep-resolver";
import { FEATURE_CONSTRUCTORS } from "../feature-constructors";
import { loadManifest } from "../manifest";
import { buildChoices } from "../picker";

function validateBoot(features: readonly FeatureDefinition[]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

async function instantiateResolved(names: readonly string[]): Promise<FeatureDefinition[]> {
  const instances: FeatureDefinition[] = [];
  for (const name of names) {
    const entry = FEATURE_CONSTRUCTORS[name];
    if (!entry) continue; // mirrors index.ts:47-49 — auto-mounted core deps have no entry
    const mod = (await import(entry.importPath)) as Record<string, unknown>;
    const exp = mod[entry.exportName];
    instances.push(
      entry.callExpression.endsWith("()")
        ? (exp as () => FeatureDefinition)()
        : (exp as FeatureDefinition),
    );
  }
  return instances;
}

describe("--yes resolved set boots (issue-1174 regression)", () => {
  const manifest = loadManifest();
  const recommended = buildChoices(manifest)
    .filter((c) => c.recommended)
    .map((c) => c.name);
  const resolved = resolveDeps(recommended, manifest);

  test("resolves user-data-rights-defaults alongside the transitively-pulled user-data-rights", () => {
    expect(resolved.featureNames).toContain("user-data-rights");
    expect(resolved.featureNames).toContain("user-data-rights-defaults");
  });

  test("the resolved --yes feature set boots without the GDPR PII-hook-coverage error", async () => {
    const instances = await instantiateResolved(resolved.featureNames);
    // sessions (auto-included, session-list/detail screens are recommended)
    // requires auth-foundation, which the dep-resolver already pulls in
    // transitively — it just needs a tokenVerifier provider mounted too.
    // PAT is what publicstatus/money-horse mount for this today.
    instances.push(createPersonalAccessTokensFeature({ scopes: {} }));
    const composed = composeFeatures(instances, { includeBundled: true });
    expect(() => validateBoot(composed)).not.toThrow();
    expect(() => createRegistry(composed)).not.toThrow();
  });
});
