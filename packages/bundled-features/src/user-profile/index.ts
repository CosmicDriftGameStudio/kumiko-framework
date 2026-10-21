// Deliberately no i18n export: the server barrel must remain compilable by server samples
// without a JSX tsconfig (i18n pulls in kumiko-renderer → .tsx). Translations are provided
// through ./web (userProfileClient).

export { createUserProfileFeature, type UserProfileFeatureOptions } from "./feature.ts";
export {
  USER_PROFILE_FEATURE,
  UserDataRightsHandlers,
  UserProfileErrors,
  UserProfileHandlers,
  UserProfileQueries,
} from "./web/constants.ts";
