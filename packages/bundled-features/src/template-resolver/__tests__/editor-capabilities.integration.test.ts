// The designer hides upload and test-mail actions the app cannot carry out; this query is what it asks.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createFilesFeature,
  createInMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { createChannelEmailFeature, createInMemoryTransport } from "../../channel-email/index.ts";
import { createConfigFeature } from "../../config/feature.ts";
import { createDeliveryFeature, createDeliveryTestContext } from "../../delivery/index.ts";
import { createTenantFeature } from "../../tenant/index.ts";
import { createUserFeature } from "../../user/feature.ts";
import { createTemplateResolverFeature } from "../feature.ts";
import { TemplateResolverQueries } from "../qualified-names.ts";

type Capabilities = { readonly fileUploads: boolean; readonly testMail: boolean };

const tenantId = testTenantId(830);
const adminWithAddress = createTestUser({ id: 831, roles: ["TenantAdmin"], tenantId });
const adminWithoutAddress = createTestUser({ id: 832, roles: ["TenantAdmin"], tenantId });
const ADDRESS = "admin@capabilities.test";

describe("template-resolver :: editor-capabilities", () => {
  describe("an app without file storage and without an email channel", () => {
    let stack: TestStack;
    beforeAll(async () => {
      stack = await setupTestStack({ features: [createTemplateResolverFeature()] });
    });
    afterAll(async () => {
      await stack.cleanup();
    });

    test("offers neither uploads nor test mails", async () => {
      const capabilities = await stack.http.queryOk<Capabilities>(
        TemplateResolverQueries.editorCapabilities,
        {},
        adminWithAddress,
      );
      expect(capabilities).toEqual({ fileUploads: false, testMail: false });
    });
  });

  describe("an app with file storage and an email channel", () => {
    let stack: TestStack;
    beforeAll(async () => {
      stack = await setupTestStack({
        features: [
          createConfigFeature(),
          createUserFeature(),
          createTenantFeature(),
          createFilesFeature(),
          createTemplateResolverFeature(),
          createDeliveryFeature(),
          createChannelEmailFeature({
            transport: createInMemoryTransport(),
            resolveEmail: async (userId) =>
              userId === String(adminWithAddress.id) ? ADDRESS : null,
          }),
        ],
        files: { storageProvider: createInMemoryFileProvider() },
        extraContext: (deps) => createDeliveryTestContext(deps),
      });
    });
    afterAll(async () => {
      await stack.cleanup();
    });

    test("offers uploads and a test mail to a user whose address resolves, without returning it", async () => {
      const capabilities = await stack.http.queryOk<Capabilities>(
        TemplateResolverQueries.editorCapabilities,
        {},
        adminWithAddress,
      );
      expect(capabilities).toEqual({ fileUploads: true, testMail: true });
      expect(JSON.stringify(capabilities)).not.toContain(ADDRESS);
    });

    test("offers no test mail to a user without an address", async () => {
      const capabilities = await stack.http.queryOk<Capabilities>(
        TemplateResolverQueries.editorCapabilities,
        {},
        adminWithoutAddress,
      );
      expect(capabilities).toEqual({ fileUploads: true, testMail: false });
    });
  });
});
