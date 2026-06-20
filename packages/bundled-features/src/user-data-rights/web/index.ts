// @runtime client
// Public exports für die Browser-Seite des user-data-rights Features —
// die anonymen Apex-Deletion-Screens. Konsumiert via Sub-Path-Export
// `@cosmicdrift/kumiko-bundled-features/user-data-rights/web`. Die Server-
// Seite (defineFeature, Handler) lebt unter `.../user-data-rights` und hat
// keine React-/DOM-Deps.

export { type UserDataRightsClientOptions, userDataRightsClient } from "./client-plugin";
export type { ConfirmAccountDeletionScreenProps } from "./confirm-deletion-screen";
export { ConfirmAccountDeletionScreen } from "./confirm-deletion-screen";
export { defaultTranslations } from "./i18n";
export { formatDate, PrivacyCenterScreen } from "./privacy-center-screen";
export type { RequestAccountDeletionScreenProps } from "./request-deletion-screen";
export { RequestAccountDeletionScreen } from "./request-deletion-screen";
