// Proves #1989/3: publicVariantQuery's `fileRefId` is UUID-validated by the
// handler's own zod schema, not only by the httpRoute wrapper's
// FILE_REF_ID_RE pre-check. The generic `/api/query` dispatch path (reachable
// once resolveApexTenant is configured, see public-variant-query-gating.
// integration.test.ts for the "not configured" case) skips that httpRoute
// pre-check entirely and calls `handler.schema.safeParse` directly — before
// this fix, a non-UUID `fileRefId` sailed through the schema and hit
// fetchOne(), throwing a Postgres 22P02 (malformed uuid literal) that
// poisons the pooled Bun.SQL connection, an unauth DoS primitive.

import { describe, expect, test } from "bun:test";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import {
  createFilesFeature,
  createInMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-framework/stack";
import { createConfigFeature } from "../../config";
import { fileFoundationFeature } from "../../file-foundation";
import { createFileDerivativesFeature } from "../feature";
import { PUBLIC_VARIANT_QN } from "../handlers/public-variant.query";

describe("file-derivatives :: publicVariant query fileRefId validation", () => {
  test("non-UUID fileRefId via /api/query → 400 validation_error, never reaches the DB", async () => {
    const stack: TestStack = await setupTestStack({
      features: [
        createConfigFeature(),
        fileFoundationFeature,
        createFilesFeature(),
        createFileDerivativesFeature({ resolveApexTenant: () => SYSTEM_TENANT_ID }),
      ],
      anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID },
      files: { storageProvider: createInMemoryFileProvider() },
    });

    try {
      const res = await stack.http.raw("POST", "/api/query", {
        type: PUBLIC_VARIANT_QN,
        payload: { fileRefId: "not-a-uuid; DROP TABLE file_refs;--", variant: "thumb" },
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error?: { code?: string } };
      expect(body.error?.code).toBe("validation_error");
    } finally {
      await stack.cleanup();
    }
  });

  test("well-formed but unknown UUID fileRefId via /api/query → 200 with null (schema passes, DB lookup just finds nothing)", async () => {
    const stack: TestStack = await setupTestStack({
      features: [
        createConfigFeature(),
        fileFoundationFeature,
        createFilesFeature(),
        createFileDerivativesFeature({ resolveApexTenant: () => SYSTEM_TENANT_ID }),
      ],
      anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID },
      files: { storageProvider: createInMemoryFileProvider() },
    });

    try {
      const res = await stack.http.raw("POST", "/api/query", {
        type: PUBLIC_VARIANT_QN,
        payload: { fileRefId: "00000000-0000-4000-8000-000000000000", variant: "thumb" },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: unknown };
      expect(body.data).toBeNull();
    } finally {
      await stack.cleanup();
    }
  });
});
