// Env Composition Sample
// Shows: the app env schema is composed from the blocks the mounted features
// register, plus app-level blocks in `extend`. The parsed env is typed from
// those blocks, so no app keeps a hand-written twin of a feature's variables.

import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import { createCryptoShreddingFeature } from "@cosmicdrift/kumiko-bundled-features/crypto-shredding";
import { createFileFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/file-foundation";
import {
  createFileProviderS3Feature,
  createS3EnvSchema,
} from "@cosmicdrift/kumiko-bundled-features/file-provider-s3";
import {
  buildInfoEnvSchema,
  demoAdminEnvSchema,
} from "@cosmicdrift/kumiko-bundled-features/foundation-shared";
import { createSecretsFeature } from "@cosmicdrift/kumiko-bundled-features/secrets";
import { stripeEnvSchema } from "@cosmicdrift/kumiko-bundled-features/subscription-stripe";
import { frameworkCoreEnvSchema } from "@cosmicdrift/kumiko-dev-server";
import { composeEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import * as z from "zod";

export function createEnvCompositionFeatures() {
  return [
    createConfigFeature(),
    createSecretsFeature(),
    createCryptoShreddingFeature(),
    createFileFoundationFeature(),
    createFileProviderS3Feature({ fromEnv: true }),
  ] as const;
}

// App-level blocks: none of these belong to a mounted feature, so they go
// into extend. A second bucket reuses the S3 block under its own prefix.
const appEnvSchema = z.object({
  ...buildInfoEnvSchema.shape,
  ...demoAdminEnvSchema.shape,
  ...stripeEnvSchema({ prices: ["PRO", "TEAM"] }).shape,
  ...createS3EnvSchema({ prefix: "RELEASES_S3_" }).shape,
  APP_PUBLIC_URL: z.url().describe("Public origin of the app, used in mail links."),
});

export function composeAppEnv(
  features: ReturnType<typeof createEnvCompositionFeatures> = createEnvCompositionFeatures(),
) {
  return composeEnvSchema({ core: frameworkCoreEnvSchema, features, extend: appEnvSchema });
}
