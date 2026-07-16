// Test-only helper — not part of the runtime surface (a real client never
// derives a code from the raw secret; the authenticator app does that).
// Kept out of the main "./auth-mfa" barrel so consumers don't see a
// server-side "valid code now" generator in autocomplete.
export { currentTotpCode } from "./totp";
