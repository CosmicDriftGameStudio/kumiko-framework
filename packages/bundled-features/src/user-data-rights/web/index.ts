// Public exports for the browser side of the user-data-rights feature —
// the anonymous Apex deletion screens. Consumed via the subpath export
// `@cosmicdrift/kumiko-bundled-features/user-data-rights/web`. The server
// side (defineFeature, Handler) lives under `.../user-data-rights` and has
// no React/DOM dependencies.

export { type UserDataRightsClientOptions, userDataRightsClient } from "./client-plugin.tsx";
export type { ConfirmAccountDeletionScreenProps } from "./confirm-deletion-screen.tsx";
export { ConfirmAccountDeletionScreen } from "./confirm-deletion-screen.tsx";
export { defaultTranslations } from "./default-translations.ts";
export { formatDate } from "./privacy-center-screen.tsx";
export { makePublicDeletionGate, type PublicDeletionRoutes } from "./public-deletion-gate.tsx";
export type { RequestAccountDeletionScreenProps } from "./request-deletion-screen.tsx";
export { RequestAccountDeletionScreen } from "./request-deletion-screen.tsx";
