// @runtime client
// Public exports für die Browser-Seite des user-data-rights Features —
// die anonymen Apex-Deletion-Screens. Konsumiert via Sub-Path-Export
// `@cosmicdrift/kumiko-bundled-features/user-data-rights/web`. Die Server-
// Seite (defineFeature, Handler) lebt unter `.../user-data-rights` und hat
// keine React-/DOM-Deps.

export { type UserDataRightsClientOptions, userDataRightsClient } from "./client-plugin.js";
export type { ConfirmAccountDeletionScreenProps } from "./confirm-deletion-screen.js";
export { ConfirmAccountDeletionScreen } from "./confirm-deletion-screen.js";
export { defaultTranslations } from "./i18n.js";
export { formatDate } from "./privacy-center-screen.js";
export { makePublicDeletionGate, type PublicDeletionRoutes } from "./public-deletion-gate.js";
export type { RequestAccountDeletionScreenProps } from "./request-deletion-screen.js";
export { RequestAccountDeletionScreen } from "./request-deletion-screen.js";
