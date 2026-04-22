import type { FileStorageProvider } from "@kumiko/framework/files";
import { createS3Provider, type S3ProviderConfig } from "./s3-provider";

// Reads S3 connection details from process.env with a configurable prefix so
// multi-tenant deploys can wire more than one bucket (S3_* for user-uploads,
// BACKUP_S3_* for archives, …). Keeps apps out of the boilerplate of hand-
// rolling a config object.
//
// Required vars: <prefix>BUCKET, <prefix>REGION, <prefix>ACCESS_KEY,
// <prefix>SECRET_KEY. Optional: <prefix>ENDPOINT (for R2/Minio),
// <prefix>FORCE_PATH_STYLE (explicit override — auto-detected when ENDPOINT
// is set).
export function createS3ProviderFromEnv(prefix = "S3_"): FileStorageProvider {
  return createS3Provider(parseS3EnvConfig(prefix));
}

// Separated from createS3ProviderFromEnv so the env → config translation is
// unit-testable without spinning up an S3Client. The returned config is a
// plain object — pass it to createS3Provider to get a working provider.
export function parseS3EnvConfig(prefix: string): S3ProviderConfig {
  const bucket = requireEnv(`${prefix}BUCKET`);
  const region = requireEnv(`${prefix}REGION`);
  const accessKeyId = requireEnv(`${prefix}ACCESS_KEY`);
  const secretAccessKey = requireEnv(`${prefix}SECRET_KEY`);
  const endpoint = process.env[`${prefix}ENDPOINT`];
  const forcePathStyleRaw = process.env[`${prefix}FORCE_PATH_STYLE`];

  return {
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    // Empty string treated as "not set" — otherwise a CI that exports
    // FOO_ENDPOINT="" to unset it would accidentally send an empty
    // endpoint to the SDK, which blows up deep in the signer.
    ...(endpoint !== undefined && endpoint !== "" && { endpoint }),
    ...(forcePathStyleRaw !== undefined && {
      forcePathStyle: forcePathStyleRaw === "true",
    }),
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`missing_env: ${name} is required to construct the S3 file provider`);
  }
  return value;
}
