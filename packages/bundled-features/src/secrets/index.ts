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
} from "./feature.ts";
export { createDeleteHandler } from "./handlers/delete.write.ts";
export { createListHandler } from "./handlers/list.query.ts";
export {
  type RotateJobPayload,
  type RotateJobResult,
  rotateJob,
} from "./handlers/rotate.job.ts";
export { createSetHandler } from "./handlers/set.write.ts";
export {
  DEFAULT_SECRETS_ACCESS,
  DEFAULT_SECRETS_ROLES,
  INVALID_SECRET_VALUE_CODE,
  SECRETS_ERROR_KEYS,
  SecretsHandlers,
  SecretsQueries,
} from "./web/constants.ts";
export { isInvalidSecretValueError } from "./write-gate.ts";
