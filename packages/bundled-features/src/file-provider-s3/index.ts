// Public API of the file-provider-s3 bundled-feature.

export { createS3EnvSchema, s3EndpointSchema, s3EnvSchema } from "./env-schema.js";
export {
  createFileProviderS3Feature,
  type FileProviderS3FeatureOptions,
  S3_SECRET_ACCESS_KEY,
} from "./feature.js";
