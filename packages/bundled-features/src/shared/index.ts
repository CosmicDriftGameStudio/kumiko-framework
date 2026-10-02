export { collectErasureFailure, throwIfErasureFailed } from "./assert-erased.js";
export {
  type ChunkedMigrationOptions,
  type ChunkedMigrationResult,
  type ChunkedMigrationStopReason,
  type MigrationRowOutcome,
  runChunkedMigration,
} from "./chunked-entity-migration.js";
export {
  classifyStoredEnvelope,
  type StoredEnvelopeClassification,
} from "./classify-stored-envelope.js";
export { decryptStoredPii } from "./decrypt-stored-pii.js";
export { encryptForDirectWrite } from "./encrypt-for-direct-write.js";
export { entitiesOf } from "./entities-of.js";
export { isWithinGracePeriod } from "./grace-period.js";
export { hasWhereRule } from "./has-where-rule.js";
export { isIdentityV3Hash, verifyIdentityV3Hash } from "./identity-v3-hash.js";
export { isTenantDb } from "./is-tenant-db.js";
export { createLockoutCounter, type LockoutCounterState } from "./lockout-counter.js";
export { mapWithConcurrency } from "./map-with-concurrency.js";
export {
  denyUnlessJoinRowParentVisible,
  joinRowParentIsVisible,
  parentRowIsVisible,
} from "./parent-visibility.js";
export { hashPassword, verifyDummyPassword, verifyPassword } from "./password-hashing.js";
export {
  type RowBoundGrantResult,
  redeemRowBoundGrant,
  signRowBoundGrant,
} from "./row-bound-grant.js";
export { runInSubTransaction } from "./run-in-sub-transaction.js";
export { sessionField } from "./session-field.js";
export { sessionLocaleField } from "./session-locale-field.js";
export { sessionTimezoneField } from "./session-timezone-field.js";
export {
  peekTokenSubject,
  signToken,
  TokenPurpose,
  type VerifyResult,
  verifyToken,
} from "./signed-token.js";
export {
  EXT_SIGNUP_HANDOVER,
  findSignupHandoverProvider,
  isSignupHandoverProvider,
  SIGNUP_HANDOVER_BENIGN_CLAIM_REJECTION_CODE,
  type SignupHandoverBinding,
  type SignupHandoverProvider,
} from "./signup-handover.js";
export { createSingleUseTokenStore, hashSingleUseToken } from "./single-use-token-store.js";
export type { SystemQueryFn } from "./system-query.js";
export { type BurnResult, burnToken, unburnToken } from "./token-burn-store.js";
