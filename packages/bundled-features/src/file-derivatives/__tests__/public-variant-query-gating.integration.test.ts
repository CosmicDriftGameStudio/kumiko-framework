// Proves #1977/2: createFileDerivativesFeature() mounted WITHOUT
// resolveApexTenant must not expose `publicVariant` via ANY path — not just
// "the httpRoute isn't mounted" (already true before the fix), but also not
// via the generic `/api/query` dispatch an anonymous, host-only-scoped
// consumer can reach. Before the fix, `r.queryHandler(publicVariantQuery)`
// ran unconditionally, registering the handler into the feature's dispatch
// table as a side effect regardless of what its return value was used for
// — so `PUBLIC_VARIANT_QN` was dispatchable even with no resolveApexTenant,
// and `ctx.user.tenantId` then came from anonymousAccess resolution instead
// of the host, bypassing the "tenantId only from the host" invariant.

import { describe, expect, test } from "bun:test";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { createFilesFeature } from "@cosmicdrift/kumiko-framework/files";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-framework/stack";
import { createConfigFeature } from "../../config";
import { fileFoundationFeature } from "../../file-foundation";
import { createFileDerivativesFeature } from "../feature";
import { PUBLIC_VARIANT_QN } from "../handlers/public-variant.query";

describe("file-derivatives :: publicVariant query gating without resolveApexTenant", () => {
  test("PUBLIC_VARIANT_QN is not dispatchable via the generic /api/query path — 404, same as any unknown query", async () => {
    const stack: TestStack = await setupTestStack({
      features: [
        createConfigFeature(),
        fileFoundationFeature,
        createFilesFeature(),
        createFileDerivativesFeature(),
      ],
      anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID },
    });

    try {
      const res = await stack.http.raw("POST", "/api/query", {
        type: PUBLIC_VARIANT_QN,
        payload: { fileRefId: "00000000-0000-4000-8000-000000000000", variant: "thumb" },
      });

      expect(res.status).toBe(404);
      expect(stack.registry.getQueryHandler(PUBLIC_VARIANT_QN)).toBeUndefined();
    } finally {
      await stack.cleanup();
    }
  });
});
