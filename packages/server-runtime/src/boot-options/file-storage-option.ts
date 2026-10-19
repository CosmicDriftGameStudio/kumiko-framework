import { createFileProviderInMemoryFeature } from "@cosmicdrift/kumiko-bundled-features/file-provider-inmemory";
import {
  createFileProviderS3Feature,
  createFileProviderS3NamedEnvFeature,
} from "@cosmicdrift/kumiko-bundled-features/file-provider-s3";
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
 *  `providers` mounts further providers so tenants can switch to them. A
 *  `{ name, envPrefix }` entry adds a named S3 provider reading `<envPrefix>BUCKET`
 *  etc.; its credentials are required at boot unless `lazy` is set.
 *
 *  @example
 *  runProdApp({ ..., fileStorage: { provider: "auto" } })
 */
export type NamedS3FileProvider = {
  readonly name: string;
  readonly envPrefix: string;
  readonly lazy?: boolean;
};

export type FileStorageBootOption = {
  readonly provider: FileStorageProviderName | "auto";
  readonly providers?: readonly (FileStorageProviderName | NamedS3FileProvider)[];
};

export function isNamedS3FileProvider(
  provider: FileStorageProviderName | NamedS3FileProvider,
): provider is NamedS3FileProvider {
  return typeof provider === "object";
}

export function s3KeysOf(envPrefix: string): readonly string[] {
  return S3_KEY_SUFFIXES.map((suffix) => `${envPrefix}${suffix}`);
}

export const FILE_FOUNDATION_FEATURE = "file-foundation";

const S3_KEY_SUFFIXES = ["BUCKET", "REGION", "ACCESS_KEY", "SECRET_KEY"] as const;
const S3_REQUIRED_ENV_KEYS = s3KeysOf("S3_");

const PROVIDER_FEATURE_NAMES: Readonly<Record<FileStorageProviderName, string>> = {
  "s3-env": "file-provider-s3-env",
  inmemory: "file-provider-inmemory",
};

function missingEnvKeys(
  envSource: Record<string, string | undefined>,
  keys: readonly string[],
): readonly string[] {
  return keys.filter((key) => !envSource[key]);
}

// Plugin names the bundled providers register: a named provider reusing one would
// shadow it (or collide at registry build) for every tenant that selects it.
const RESERVED_PROVIDER_NAMES: ReadonlySet<string> = new Set(["s3-env", "s3", "inmemory"]);

function assertNamedProviderNames(named: readonly NamedS3FileProvider[]): void {
  const seen = new Set<string>();
  for (const { name } of named) {
    if (RESERVED_PROVIDER_NAMES.has(name)) {
      throw new Error(
        `[runProdApp] fileStorage provider name "${name}" is reserved for a bundled provider — pick another name.`,
      );
    }
    if (seen.has(name)) {
      throw new Error(`[runProdApp] fileStorage provider "${name}" is listed twice.`);
    }
    seen.add(name);
  }
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
  const missingS3 = missingEnvKeys(deps.envSource, S3_REQUIRED_ENV_KEYS);
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
  const additional = fileStorage.providers ?? [];
  const wanted = new Set<FileStorageProviderName>([
    provider,
    ...additional.filter(
      (entry): entry is FileStorageProviderName => !isNamedS3FileProvider(entry),
    ),
  ]);
  const named = additional.filter(isNamedS3FileProvider);
  assertNamedProviderNames(named);
  for (const entry of named) {
    const missing = entry.lazy ? [] : missingEnvKeys(deps.envSource, s3KeysOf(entry.envPrefix));
    if (missing.length > 0) {
      throw new Error(
        `[runProdApp] fileStorage provider "${entry.name}" is missing: ${missing.join(", ")}.`,
      );
    }
  }
  const features = [
    ...[...wanted]
      .filter((name) => !deps.mountedFeatureNames.has(PROVIDER_FEATURE_NAMES[name]))
      .map(buildProviderFeature),
    ...named
      .filter((entry) => !deps.mountedFeatureNames.has(`file-provider-s3-env-${entry.name}`))
      .map((entry) =>
        createFileProviderS3NamedEnvFeature({ name: entry.name, envPrefix: entry.envPrefix }),
      ),
  ];
  return {
    provider,
    features,
    envDefaults: deps.envSource[FILE_STORAGE_PROVIDER_ENV]
      ? {}
      : { [FILE_STORAGE_PROVIDER_ENV]: provider },
  };
}
