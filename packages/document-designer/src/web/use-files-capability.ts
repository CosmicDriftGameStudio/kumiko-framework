import { useAppFeatures } from "@cosmicdrift/kumiko-renderer";
import { FILES_FEATURE_NAME } from "./constants.ts";

// The app schema lists every mounted feature, screenless ones included, so this is the server's
// answer: without the files feature there is no upload route.
export function useFilesCapability(): boolean {
  return useAppFeatures().some((feature) => feature.featureName === FILES_FEATURE_NAME);
}
