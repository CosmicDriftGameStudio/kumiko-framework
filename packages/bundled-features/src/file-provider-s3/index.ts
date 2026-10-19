// Public API of the file-provider-s3 bundled-feature.

export {
  createFileProviderS3NamedEnvFeature,
  type NamedS3EnvProviderOptions,
} from "./env-named-feature.ts";
export { createS3EnvSchema, s3EndpointSchema, s3EnvSchema } from "./env-schema.ts";
export {
  createFileProviderS3Feature,
  type FileProviderS3FeatureOptions,
  S3_SECRET_ACCESS_KEY,
} from "./feature.ts";
