import { qualifyEntityName } from "../qualified-name";
import type { FeatureDefinition } from "../types";
import type { ScreenDefinition } from "../types/screen";
import { findEntityFeature } from "./screens";

// Entity name → the one screen that declares detailFor: "<entity>". Built
// once, up front (before the per-feature validateScreens loop) so both this
// module's own uniqueness check AND rowAction entity-targets (fw#2228,
// screens.ts) resolve against the same map instead of re-walking every
// feature's screens twice.
export function collectDetailForScreens(
  features: readonly FeatureDefinition[],
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): Map<string, { readonly featureName: string; readonly screen: ScreenDefinition }> {
  const screenQnByEntity = new Map<string, string>();
  const result = new Map<
    string,
    { readonly featureName: string; readonly screen: ScreenDefinition }
  >();

  for (const feature of features) {
    for (const [screenId, screen] of Object.entries(feature.screens)) {
      const detailFor = screen.detailFor;
      if (detailFor === undefined) continue;

      const qualified = qualifyEntityName(feature.name, "screen", screenId);

      const existingQn = screenQnByEntity.get(detailFor);
      if (existingQn !== undefined) {
        throw new Error(
          `[detailFor] Screens "${existingQn}" and "${qualified}" both declare ` +
            `detailFor: "${detailFor}" — only one screen may be the detail view for an entity.`,
        );
      }
      screenQnByEntity.set(detailFor, qualified);

      if (findEntityFeature(detailFor, featureMap) === undefined) {
        throw new Error(
          `[detailFor] Screen "${qualified}" declares detailFor: "${detailFor}", ` +
            `but no feature registers an entity with that name.`,
        );
      }

      result.set(detailFor, { featureName: feature.name, screen });
    }
  }

  return result;
}
