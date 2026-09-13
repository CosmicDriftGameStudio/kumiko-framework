import { useUserRoles } from "../context/user-roles-context";
import { useAppFeatures } from "./app-features-context";
import type { FeatureSchema } from "./feature-schema";
import { featureNameFromQualifiedScreenId, qualifyScreenId } from "./qualify-screen-id";
import { screenAccessAllows } from "./screen-access";

export type EmbeddedScreenTarget = {
  readonly schema: FeatureSchema;
  readonly qn: string;
};

// Undefined (not KumikoScreen's access-denied banner) so the host can drop the whole tile.
export function useEmbeddedScreen(
  hostFeatureName: string,
  screen: string,
): EmbeddedScreenTarget | undefined {
  const features = useAppFeatures();
  const userRoles = useUserRoles();
  const crossFeatureName = featureNameFromQualifiedScreenId(screen);
  const targetFeatureName = crossFeatureName ?? hostFeatureName;
  const qn = crossFeatureName !== undefined ? screen : qualifyScreenId(hostFeatureName, screen);
  const schema = features.find((f) => f.featureName === targetFeatureName);
  const target = schema?.screens.find((s) => qualifyScreenId(targetFeatureName, s.id) === qn);
  if (schema === undefined || target === undefined) return undefined;
  if (!screenAccessAllows(target.access, userRoles)) return undefined;
  return { schema, qn };
}
