import { qualifyEntityName } from "../qualified-name";
import type { FeatureDefinition } from "../types";
import { findEntityFeature } from "./screens";

export function validateDetailForScreens(
  features: readonly FeatureDefinition[],
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  const screenQnByEntity = new Map<string, string>();

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
    }
  }
}
