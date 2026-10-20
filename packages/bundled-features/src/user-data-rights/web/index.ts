// @runtime client
// Public exports für die Browser-Seite des user-data-rights Features —
// die anonymen Apex-Deletion-Screens. Konsumiert via Sub-Path-Export
// `@cosmicdrift/kumiko-bundled-features/user-data-rights/web`. Die Server-
// Seite (defineFeature, Handler) lebt unter `.../user-data-rights` und hat
// keine React-/DOM-Deps.

export { type UserDataRightsClientOptions, userDataRightsClient } from "./client-plugin.tsx";
export type { ConfirmAccountDeletionScreenProps } from "./confirm-deletion-screen.tsx";
export { ConfirmAccountDeletionScreen } from "./confirm-deletion-screen.tsx";
export { defaultTranslations } from "./default-translations.ts";
export { formatDate } from "./privacy-center-screen.tsx";
export { makePublicDeletionGate, type PublicDeletionRoutes } from "./public-deletion-gate.tsx";
export type { RequestAccountDeletionScreenProps } from "./request-deletion-screen.tsx";
export { RequestAccountDeletionScreen } from "./request-deletion-screen.tsx";
