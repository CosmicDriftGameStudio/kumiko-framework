import { expect, test } from "bun:test";
import { dedupeFeatures } from "@cosmicdrift/kumiko-framework/engine";
import * as billing from "../billing-foundation/index.js";
import * as fileDerivatives from "../file-derivatives/index.js";
import * as foundation from "../file-foundation/index.js";
import * as s3 from "../file-provider-s3/index.js";
import * as tags from "../tags/index.js";
import * as tenantSettings from "../tenant-settings/index.js";
import * as tierEngine from "../tier-engine/index.js";

test("two no-option calls of a factory dedupe to one instance, fromEnv stays a separate feature variant", () => {
  const list = [
    tenantSettings.createTenantSettingsFeature(),
    tenantSettings.createTenantSettingsFeature(),
    tierEngine.createTierEngineFeature(),
    tierEngine.createTierEngineFeature(),
    billing.createBillingFoundationFeature(),
    billing.createBillingFoundationFeature(),
    fileDerivatives.createFileDerivativesFeature(),
    fileDerivatives.createFileDerivativesFeature(),
    tags.createTagsFeature(),
    tags.createTagsFeature(),
    s3.createFileProviderS3Feature(),
    s3.createFileProviderS3Feature(),
    s3.createFileProviderS3Feature({ fromEnv: true }),
    s3.createFileProviderS3Feature({ fromEnv: true }),
    foundation.createFileFoundationFeature(),
    foundation.createFileFoundationFeature(),
  ];
  expect(dedupeFeatures(list).length).toBe(8);
});
