import { createFileProviderInMemoryFeature } from "@cosmicdrift/kumiko-bundled-features/file-provider-inmemory";
import { createFileProviderS3Feature } from "@cosmicdrift/kumiko-bundled-features/file-provider-s3";
import {
  type FeatureDefinition,
  FILE_STORAGE_PROVIDER_ENV,
} from "@cosmicdrift/kumiko-framework/engine";

export type FileStorageProviderName = "s3-env" | "inmemory";

/** Mounts the file provider feature(s) for `file-foundation` and makes the
 *  chosen one the default (`FILE_STORAGE_PROVIDER`, an explicit env value wins).
 *  - `"s3-env"`: one bucket from `S3_BUCKET` / `S3_REGION` / `S3_ACCESS_KEY` /
 *    `S3_SECRET_KEY` (optional `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`); missing
 *    values abort the boot.
 *  - `"inmemory"`: bytes live in process memory; refused with `NODE_ENV=production`.
 *  - `"auto"`: `"s3-env"` when the S3 env is complete; otherwise a boot error
 *    with `NODE_ENV=production` and `"inmemory"` elsewhere.
 *
 *  `providers` mounts further providers so tenants can switch to them.
 *
 *  @example
 *  runProdApp({ ..., fileStorage: { provider: "auto" } })
 */
export type FileStorageBootOption = {
  readonly provider: FileStorageProviderName | "auto";
  readonly providers?: readonly FileStorageProviderName[];
};

export const FILE_FOUNDATION_FEATURE = "file-foundation";

const S3_REQUIRED_ENV_KEYS = ["S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY", "S3_SECRET_KEY"] as const;

const PROVIDER_FEATURE_NAMES: Readonly<Record<FileStorageProviderName, string>> = {
  "s3-env": "file-provider-s3-env",
  inmemory: "file-provider-inmemory",
};

function missingS3EnvKeys(envSource: Record<string, string | undefined>): readonly string[] {
  return S3_REQUIRED_ENV_KEYS.filter((key) => !envSource[key]);
}

function buildProviderFeature(provider: FileStorageProviderName): FeatureDefinition {
  return provider === "s3-env"
    ? createFileProviderS3Feature({ fromEnv: true })
    : createFileProviderInMemoryFeature();
}

export function resolveFileStorageOption(
  fileStorage: FileStorageBootOption,
  deps: {
    readonly envSource: Record<string, string | undefined>;
    readonly isProduction: boolean;
    readonly mountedFeatureNames: ReadonlySet<string>;
  },
): {
  readonly provider: FileStorageProviderName;
  readonly features: readonly FeatureDefinition[];
  readonly envDefaults: Readonly<Record<string, string>>;
} {
  const missingS3 = missingS3EnvKeys(deps.envSource);
  let provider: FileStorageProviderName;
  if (fileStorage.provider === "auto") {
    if (missingS3.length === 0) {
      provider = "s3-env";
    } else if (deps.isProduction) {
      throw new Error(
        `[runProdApp] fileStorage "auto" with NODE_ENV=production needs S3, missing: ${missingS3.join(", ")}.`,
      );
    } else {
      provider = "inmemory";
    }
  } else {
    provider = fileStorage.provider;
  }
  if (provider === "s3-env" && missingS3.length > 0) {
    throw new Error(`[runProdApp] fileStorage "s3-env" is missing: ${missingS3.join(", ")}.`);
  }
  if (provider === "inmemory" && deps.isProduction) {
    throw new Error(
      '[runProdApp] fileStorage "inmemory" loses every file on restart — not allowed with NODE_ENV=production.',
    );
  }
  const wanted = new Set<FileStorageProviderName>([provider, ...(fileStorage.providers ?? [])]);
  const features = [...wanted]
    .filter((name) => !deps.mountedFeatureNames.has(PROVIDER_FEATURE_NAMES[name]))
    .map(buildProviderFeature);
  return {
    provider,
    features,
    envDefaults: deps.envSource[FILE_STORAGE_PROVIDER_ENV]
      ? {}
      : { [FILE_STORAGE_PROVIDER_ENV]: provider },
  };
}
