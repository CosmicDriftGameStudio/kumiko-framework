// Issue #912 — Teilbare Entity-Permalinks. Der Copy-Link-Button selbst ist
// UI-Zucker (baut eine URL, kopiert sie); die eigentliche Anforderung des
// Issues ist "ein Permalink darf nie Auth/Tenant-Isolation umgehen". Ein
// entityEdit-Permalink öffnet beim Klick exactly denselben
// `<feature>:query:<entity>:detail`-Call, den jede Entity schon für ihr
// Update-Formular nutzt — es gibt keinen separaten Permalink-Resolve-Pfad.
// Dieser Test beweist den Deny für beide Achsen, die einen Leak verhindern
// müssten: Rollen-Gate (dispatcher-seitig, default-deny) und Tenant-Scoping
// (strukturell über ctx.db).

import { describe, expect, test } from "bun:test";
import { setupTestStackFromFeatures } from "@cosmicdrift/kumiko-dev-server/setup-test-stack-from-features";
import {
  createEntity,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDetailHandler,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  pushEntityProjectionTables,
  testTenantId,
} from "@cosmicdrift/kumiko-framework/stack";

const noteEntity = createEntity({
  table: "read_permalink_notes",
  fields: {
    title: createTextField({ required: true, maxLength: 160, allowPlaintext: "is-business-data" }),
  },
});

const permalinkFeature = defineFeature("permalink-fixture", (r) => {
  r.entity("note", noteEntity);
  const access = { roles: ["TenantAdmin"] } as const;
  r.writeHandler(defineEntityCreateHandler("note", noteEntity, { access }));
  r.queryHandler(defineEntityDetailHandler("note", noteEntity, { access }));
});

describe("entityEdit permalink open-path denies cleanly", () => {
  test("unauthorized role → AccessDeniedError, not the record", async () => {
    const stack = await setupTestStackFromFeatures([permalinkFeature]);
    try {
      const tenantId = testTenantId(701);
      const owner = createTestUser({ id: 701, tenantId, roles: ["TenantAdmin"] });
      const outsider = createTestUser({ id: 702, tenantId, roles: ["TeamMember"] });
      await pushEntityProjectionTables(stack, stack.registry);

      const created = await stack.http.writeOk<{ id: string }>(
        "permalink-fixture:write:note:create",
        { title: "Q3 Forecast" },
        owner,
      );

      const res = await stack.http.query(
        "permalink-fixture:query:note:detail",
        { id: created.id },
        outsider,
      );
      expect(res.ok).toBe(false);
      const body = (await res.json()) as { isSuccess?: boolean; error?: { code?: string } };
      expect(body.isSuccess).not.toBe(true);
      expect(body.error?.code).toBe("access_denied");
    } finally {
      await stack.cleanup();
    }
  });

  test("cross-tenant open → not-found, not the other tenant's record", async () => {
    const stack = await setupTestStackFromFeatures([permalinkFeature]);
    try {
      const tenantA = testTenantId(703);
      const tenantB = testTenantId(704);
      const ownerA = createTestUser({ id: 703, tenantId: tenantA, roles: ["TenantAdmin"] });
      const adminB = createTestUser({ id: 704, tenantId: tenantB, roles: ["TenantAdmin"] });
      await pushEntityProjectionTables(stack, stack.registry);

      const created = await stack.http.writeOk<{ id: string }>(
        "permalink-fixture:write:note:create",
        { title: "Tenant A Secret" },
        ownerA,
      );

      const row = await stack.http.queryOk<Record<string, unknown> | null>(
        "permalink-fixture:query:note:detail",
        { id: created.id },
        adminB,
      );
      expect(row).toBeNull();
    } finally {
      await stack.cleanup();
    }
  });
});
