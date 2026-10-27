import { type UseQueryResult, useAppFeatures, useQuery } from "@cosmicdrift/kumiko-renderer";
import { BRANDING_QUERY_QN, MANAGED_PAGES_FEATURE_NAME } from "./constants.ts";
import type { BrandingView } from "./layout-types.ts";

// Branding belongs to managed-pages. In an app without it the query has no handler, so every
// editor open would log a 404; the editors show branding as unavailable instead.
export function useBranding(): UseQueryResult<BrandingView> {
  const mounted = useAppFeatures().some(
    (feature) => feature.featureName === MANAGED_PAGES_FEATURE_NAME,
  );
  return useQuery<BrandingView>(BRANDING_QUERY_QN, {}, { enabled: mounted });
}
