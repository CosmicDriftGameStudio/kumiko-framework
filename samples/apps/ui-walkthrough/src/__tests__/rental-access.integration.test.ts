import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { setupAppTestStack } from "@cosmicdrift/kumiko-dev-server/testing";
import {
  createFilesFeature,
  createInMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { rentalFeature } from "../features/rental/feature";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupAppTestStack([createFilesFeature(), rentalFeature], {
    files: { storageProvider: createInMemoryFileProvider() },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("rental property exposé", () => {
  test("a caller without the TenantAdmin role is rejected before anything renders", async () => {
    const error = await stack.http.writeErr(
      "rental:write:generate-property-expose",
      { propertyAddress: "Lindenstraße 14", propertySummary: "Altbau", photos: [] },
      createTestUser({ id: 2, roles: ["User"] }),
    );
    expect(error.code).toBe("access_denied");
  });
});
