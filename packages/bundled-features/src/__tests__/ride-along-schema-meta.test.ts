// Regression for framework#347: the migration generator (collectTableMetas)
// must see the ride-along columns/indexes that live only on a feature's
// backing Drizzle table, not just the entity fields. Before the fix the
// generated migration omitted them → prod-500 (publicstatus#116). Guards the
// `r.entity(name, def, { table })` wiring on the two real ride-along features
// so a future removal of the `{ table }` arg fails here.

import { describe, expect, test } from "bun:test";
import { collectTableMetas } from "@cosmicdrift/kumiko-framework/db";
import { createDeliveryFeature } from "../delivery/feature";
import { createSecretsFeature } from "../secrets/feature";

describe("ride-along schema metas reach the generator (framework#347)", () => {
  test("secrets read_tenant_secrets: envelope/metadata/last_rotated_at + (tenant,key) uniqueIndex", () => {
    const meta = collectTableMetas([createSecretsFeature()]).find(
      (m) => m.tableName === "read_tenant_secrets",
    );
    const cols = meta?.columns.map((c) => c.name) ?? [];
    expect(cols).toContain("envelope");
    expect(cols).toContain("metadata");
    expect(cols).toContain("last_rotated_at");
    expect(meta?.indexes.map((i) => i.name)).toContain("read_tenant_secrets_tenant_key_unique");
  });

  test("delivery read_notification_preferences: (tenant,user,type,channel) uniqueIndex", () => {
    const meta = collectTableMetas([createDeliveryFeature()]).find(
      (m) => m.tableName === "read_notification_preferences",
    );
    const unique = meta?.indexes.find((i) => i.name === "read_notification_preferences_unique");
    expect(unique).toBeDefined();
    expect(unique?.unique).toBe(true);
  });
});
