// Bewusst OHNE i18n-Export: das Server-Barrel muss von Server-Samples
// ohne jsx-tsconfig kompilierbar bleiben (i18n zieht kumiko-renderer →
// .tsx). Translations kommen via ./web (userProfileClient).
export {
  USER_PROFILE_FEATURE,
  UserDataRightsHandlers,
  UserProfileErrors,
  UserProfileHandlers,
  UserProfileQueries,
} from "./constants";
export { createUserProfileFeature } from "./feature";
