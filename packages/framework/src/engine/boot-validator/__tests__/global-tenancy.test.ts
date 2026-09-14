// fw#2858 — a `tenancy: "global"` entity's event stream must live on
// SYSTEM_TENANT_ID (systemStream: true); otherwise it would silently fork
// one stream per creating tenant while still being writable/readable
// cross-tenant via db.global(table).

import { describe, expect, test } from "bun:test";
import { defineFeature } from "../../define-feature";
import { createEntity, createTextField } from "../../factories";
import { validateGlobalTenancyEntities } from "../global-tenancy";

const textField = () =>
  createTextField({
    required: true,
    maxLength: 64,
    personal: false,
    reason: "technical_reference",
  });

describe("validateGlobalTenancyEntities", () => {
  test("a tenancy: 'global' entity WITHOUT systemStream: true throws", () => {
    const entity = createEntity({
      table: "read_fw2858_global_no_stream",
      tenancy: "global",
      fields: { name: textField() },
    });
    const feature = defineFeature("fw2858-global-no-stream", (r) => {
      r.entity("fw2858GlobalNoStream", entity);
    });

    expect(() => validateGlobalTenancyEntities([feature])).toThrow(/systemStream/);
  });

  test("a tenancy: 'global' entity WITH systemStream: true but WITHOUT r.systemScope() throws", () => {
    const entity = createEntity({
      table: "read_fw2860_global_no_scope",
      tenancy: "global",
      systemStream: true,
      fields: { name: textField() },
    });
    const feature = defineFeature("fw2860-global-no-scope", (r) => {
      r.entity("fw2860GlobalNoScope", entity);
    });

    expect(() => validateGlobalTenancyEntities([feature])).toThrow(/systemScope/);
  });

  test("a tenancy: 'global' entity WITH systemStream: true AND r.systemScope() passes", () => {
    const entity = createEntity({
      table: "read_fw2858_global_with_stream",
      tenancy: "global",
      systemStream: true,
      fields: { name: textField() },
    });
    const feature = defineFeature("fw2858-global-with-stream", (r) => {
      r.systemScope();
      r.entity("fw2858GlobalWithStream", entity);
    });

    expect(() => validateGlobalTenancyEntities([feature])).not.toThrow();
  });

  test("a tenant-tenancy entity without systemStream is never checked", () => {
    const entity = createEntity({
      table: "read_fw2858_tenant_entity",
      fields: { name: textField() },
    });
    const feature = defineFeature("fw2858-tenant-entity", (r) => {
      r.entity("fw2858TenantEntity", entity);
    });

    expect(() => validateGlobalTenancyEntities([feature])).not.toThrow();
  });
});
