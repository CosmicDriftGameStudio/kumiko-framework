// Moved to shared/ — reused across admin-shell, audit, sessions, tenant,
// user-data-rights, user-profile, and now auth-mfa. Re-exported here for the
// existing call sites within this feature that import via "./password-hashing".
export { hashPassword, verifyDummyPassword, verifyPassword } from "../shared/password-hashing";
