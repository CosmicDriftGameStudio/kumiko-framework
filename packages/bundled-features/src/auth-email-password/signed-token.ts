// Moved to shared/signed-token.ts — the mechanism was never specific to
// email/password auth (user-data-rights and any row-bound grant use it too).
// Re-exported so this feature's barrel and external importers keep working.
export * from "../shared/signed-token";
