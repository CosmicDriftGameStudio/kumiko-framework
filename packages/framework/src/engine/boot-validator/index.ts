import { dedupeFeatures } from "../dedupe-features.ts";
import type { FeatureDefinition } from "../types/index.ts";
import { buildBootContext } from "./boot-context.ts";
import type { ValidateBootOptions } from "./boot-options.ts";
import { runFeaturePhase, runStructurePhase } from "./boot-phases.ts";
import { runAppWidePhase, runEnvironmentPhase } from "./boot-phases-app.ts";
import { createBootReport } from "./boot-report.ts";
import { emitBootWarnings } from "./boot-warnings.ts";
import { collectNavQns, validateNavCycles, validateNavs } from "./nav.ts";
import { collectScreenQns } from "./screens.ts";
import { collectWorkspaceQns, validateWorkspaces } from "./workspaces.ts";

export type { ValidateBootOptions } from "./boot-options.ts";
// Re-export: run-dev-app.ts needs this to pass write-handler QNs
// to codegen. It is not part of validateBoot, but uses the same
// extraction logic.
export { type CardMetaOverflow, collectCardMetaOverflow } from "./card-meta-overflow.ts";
export { validateAppCustomScreenWriteQns } from "./custom-screen-write-qns.ts";
export { collectWriteHandlerQns } from "./nav.ts";
export { SECURITY_BASELINE_FEATURE_NAMES } from "./security-baseline.ts";
export { MAX_TRANSFER_DEPTH } from "./transfer-graph.ts";

// Test stacks mount feature subsets, so a reference into a feature that is not
// mounted cannot be judged: it counts as present. A reference into a mounted
// feature must still resolve.
function mountedPrefixOf(qn: string): string {
  return qn.split(":", 1)[0] ?? qn;
}

class PrefixTolerantSet extends Set<string> {
  constructor(
    members: Iterable<string>,
    private readonly mountedFeatures: ReadonlySet<string>,
  ) {
    super(members);
  }
  override has(qn: string): boolean {
    return super.has(qn) || !this.mountedFeatures.has(mountedPrefixOf(qn));
  }
}

class PrefixTolerantMap<V> extends Map<string, V> {
  constructor(
    members: Iterable<readonly [string, V]>,
    private readonly mountedFeatures: ReadonlySet<string>,
  ) {
    super(members);
  }
  override has(qn: string): boolean {
    return super.has(qn) || !this.mountedFeatures.has(mountedPrefixOf(qn));
  }
}

/**
 * Subset-safe slice of validateBoot for test stacks: nav references (screen,
 * parent, workspace, tree actions), workspaces and nav cycles. The checks that
 * need the whole app composition (screens, ref entities) run only in validateBoot.
 */
export function validateNavBootSubset(rawFeatures: readonly FeatureDefinition[]): void {
  const features = dedupeFeatures(rawFeatures);
  const mounted: ReadonlySet<string> = new Set(features.map((f) => f.name));
  const allNavQns = collectNavQns(features);
  const tolerantScreens = new PrefixTolerantSet(collectScreenQns(features), mounted);
  const tolerantNavs = new PrefixTolerantMap(allNavQns, mounted);
  const tolerantWorkspaces = new PrefixTolerantMap(collectWorkspaceQns(features), mounted);
  const report = createBootReport();
  for (const feature of features) {
    report.check("validateNavs", feature.name, () =>
      validateNavs(feature, tolerantScreens, tolerantNavs, tolerantWorkspaces),
    );
    report.check("validateWorkspaces", feature.name, () =>
      validateWorkspaces(feature, tolerantNavs),
    );
  }
  report.check("validateNavCycles", undefined, () => validateNavCycles(allNavQns));
  report.finish();
}

/**
 * Validates all feature configurations at boot time.
 * Collects violations per phase and throws them as one BootValidationError, so a
 * single run reports everything fixable at once. Structural violations (phase 1)
 * abort before the later phases, whose checks would only echo them as follow-ups.
 */
export function validateBoot(
  rawFeatures: readonly FeatureDefinition[],
  options?: ValidateBootOptions,
): void {
  const ctx = buildBootContext(dedupeFeatures(rawFeatures), options);
  const report = createBootReport();
  const detailForScreens = runStructurePhase(report, ctx);
  const flags = runFeaturePhase(report, ctx, detailForScreens);
  runAppWidePhase(report, ctx);
  runEnvironmentPhase(report, ctx, flags);
  report.finish();
  emitBootWarnings(ctx);
}
