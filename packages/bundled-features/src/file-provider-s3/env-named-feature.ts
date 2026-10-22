import type {
  FileProviderContext,
  FileProviderPlugin,
} from "@cosmicdrift/kumiko-bundled-features/file-foundation";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { featureWithEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import type { FileStorageProvider } from "@cosmicdrift/kumiko-framework/files";
import { createRuntimeS3EnvSchema } from "./env-schema.ts";
import { createS3ProviderFromEnv } from "./lib/env-helper.ts";

export type NamedS3EnvProviderOptions = {
  /** Provider key tenants select in `file-foundation`'s `provider` config; the feature is `file-provider-s3-env-<name>`. */
  readonly name: string;
  /** Env prefix of the credential set, e.g. `RELEASES_S3_`. */
  readonly envPrefix: string;
};

/** An additional S3 provider next to `"s3-env"`, reading its credentials from `<envPrefix>BUCKET` etc. */
export function createFileProviderS3NamedEnvFeature(options: NamedS3EnvProviderOptions) {
  const envSchema = createRuntimeS3EnvSchema(options.envPrefix);
  const feature = defineFeature(
    `file-provider-s3-env-${options.name}`,
    (r) => {
      r.describe(
        `Registers the "${options.name}" provider for \`file-foundation\`: one shared S3 bucket for every tenant, credentials from the \`${options.envPrefix}*\` env vars. A second bucket next to the \`"s3-env"\` provider (for example release artifacts).`,
      );
      r.uiHints({
        displayLabel: `File Provider · S3 (${options.name})`,
        category: "storage",
        recommended: false,
      });
      r.requires({ features: ["file-foundation"] });
      r.envSchema(envSchema);
      const plugin: FileProviderPlugin = {
        build: async (_ctx: FileProviderContext, _tenantId: string): Promise<FileStorageProvider> =>
          createS3ProviderFromEnv(options.envPrefix), // @wrapper-known semantic-alias
      };
      r.useExtension("fileProvider", options.name, plugin);
    },
    { dedupeOptions: { name: options.name, envPrefix: options.envPrefix } },
  );
  return featureWithEnvSchema(feature, envSchema);
}
