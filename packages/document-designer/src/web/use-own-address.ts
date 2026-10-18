// @runtime client
import { useAppFeatures, useQuery } from "@cosmicdrift/kumiko-renderer";
import { PROFILE_FEATURE_NAME, PROFILE_SCREEN_ID, USER_ME_QUERY_QN } from "../constants.ts";

export type OwnAddress = {
  readonly email: string | null;
  // The profile screen is where the address changes; apps without it get no link.
  readonly profileScreenId: string | null;
};

export function useOwnAddress(): OwnAddress {
  const features = useAppFeatures();
  const me = useQuery<{ readonly email?: unknown } | null>(USER_ME_QUERY_QN, {});
  const email = me.data?.email;
  const hasProfileScreen = features.some(
    (feature) =>
      feature.featureName === PROFILE_FEATURE_NAME &&
      feature.screens.some((screen) => screen.id === PROFILE_SCREEN_ID),
  );
  return {
    email: typeof email === "string" && email !== "" ? email : null,
    profileScreenId: hasProfileScreen ? PROFILE_SCREEN_ID : null,
  };
}
