export {
  DEFAULT_SECRETS_ACCESS,
  DEFAULT_SECRETS_ROLES,
  INVALID_SECRET_VALUE_CODE,
  SECRETS_ERROR_KEYS,
} from "./constants.js";
export {
  createSecretsContext,
  createSecretsFeature,
  requireSecretsContext,
  SECRETS_FEATURE_NAME,
  SECRETS_MASTER_KEK_ENV_KEYS,
  type SecretsContext,
  type SecretsContextOptions,
  type SecretsFeatureOptions,
  type StoredEnvelope,
  type StoredMetadata,
  secretsEnvSchema,
  TENANT_SECRET_READ_EVENT,
  tenantSecretsTable,
} from "./feature.js";
export { createDeleteHandler } from "./handlers/delete.write.js";
export { createListHandler } from "./handlers/list.query.js";
export {
  type RotateJobPayload,
  type RotateJobResult,
  rotateJob,
} from "./handlers/rotate.job.js";
export { createSetHandler } from "./handlers/set.write.js";
export { isInvalidSecretValueError } from "./write-gate.js";
