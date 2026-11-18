import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import type { FieldDefinition } from "@cosmicdrift/kumiko-types/fields";
import * as z from "zod";
import { buildEntityTable } from "../../../db/table-builder.ts";
import { validateBoot } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import {
  createEmbeddedListField,
  createEntity,
  createFilesField,
  createTextField,
} from "../../factories.ts";
import type { FeatureDefinition } from "../../types/index.ts";
import { validateCrossTenantFileRead } from "../cross-tenant-file-read.ts";
import { buildQueryHandlerMap } from "../projection-list-screens.ts";

const text = () =>
  createTextField({
    required: true,
    maxLength: 64,
    personal: false,
    reason: "technical_reference",
  });

function featureDeclaring(
  query: string,
  reason: string,
  extraFields: Record<string, FieldDefinition> = {},
): FeatureDefinition {
  return defineFeature("requests", (r) => {
    r.entity(
      createEntity({
        name: "request",
        table: "cross_tenant_file_read_boot_requests",
        fields: { title: text(), ...extraFields },
        crossTenantFileRead: { query, reason },
      }),
    );
    r.queryHandler({
      name: "request:visible-to-me",
      schema: z.object({ id: z.string() }),
      handler: async () => null,
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
    });
  });
}

function check(feature: FeatureDefinition): void {
  validateCrossTenantFileRead(
    feature,
    buildQueryHandlerMap([feature]),
    new Set(Object.keys(feature.entities ?? {})),
  );
}

describe("validateCrossTenantFileRead", () => {
  test("accepts a registered query and a reason", () => {
    expect(() =>
      check(featureDeclaring("requests:query:request:visible-to-me", "buyers see their photos")),
    ).not.toThrow();
  });

  test("rejects an unregistered query", () => {
    expect(() => check(featureDeclaring("requests:query:ghost", "because"))).toThrow(
      /not a registered query-handler/,
    );
  });

  test("rejects an empty reason", () => {
    expect(() => check(featureDeclaring("requests:query:request:visible-to-me", "  "))).toThrow(
      /without a reason/,
    );
  });

  test("rejects a file field with its own read access", () => {
    const feature = featureDeclaring(
      "requests:query:request:visible-to-me",
      "buyers see their photos",
      { photos: createFilesField({ access: { read: ["Admin"] } }) },
    );
    expect(() => check(feature)).toThrow(/declares crossTenantFileRead, but its file field/);
  });

  test("rejects an embedded file sub-field with its own read access", () => {
    const feature = featureDeclaring(
      "requests:query:request:visible-to-me",
      "buyers see their photos",
      {
        checks: createEmbeddedListField(
          { photos: { type: "files", access: { read: ["Admin"] } } },
          { personal: false, reason: "is_business_data" },
        ),
      },
    );
    expect(() => check(feature)).toThrow(/declares crossTenantFileRead, but its file field/);
  });

  test("accepts a file field without a read rule", () => {
    const feature = featureDeclaring(
      "requests:query:request:visible-to-me",
      "buyers see their photos",
      { photos: createFilesField() },
    );
    expect(() => check(feature)).not.toThrow();
  });
});

describe("validateCrossTenantFileRead on a read-model entity", () => {
  function readModelDeclaring(
    query: string,
    reason: string,
    extraFields: Record<string, FieldDefinition> = {},
  ): FeatureDefinition {
    const entity = createEntity({
      name: "request-view",
      table: "cross_tenant_file_read_boot_request_views",
      fields: { title: text(), ...extraFields },
      crossTenantFileRead: { query, reason },
    });
    return defineFeature("requests", (r) => {
      r.defineEvent("request-received", z.object({}), { piiFields: "none" });
      r.projection({
        name: "request-view",
        source: "request-view",
        table: buildEntityTable(entity),
        entity,
        apply: { "requests:event:request-received": async () => {} },
      });
      r.queryHandler({
        name: "request-view:visible-to-me",
        schema: z.object({ id: z.string() }),
        handler: async () => null,
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
    });
  }

  test("accepts a registered query and a reason", () => {
    expect(() =>
      check(readModelDeclaring("requests:query:request-view:visible-to-me", "buyers see photos")),
    ).not.toThrow();
  });

  test("rejects an unregistered query", () => {
    expect(() => check(readModelDeclaring("requests:query:ghost", "because"))).toThrow(
      /entity "request-view" declares crossTenantFileRead.query "requests:query:ghost"/,
    );
  });

  test("rejects an empty reason", () => {
    expect(() =>
      check(readModelDeclaring("requests:query:request-view:visible-to-me", " ")),
    ).toThrow(/entity "request-view" declares crossTenantFileRead without a reason/);
  });

  test("rejects a file field with its own read access", () => {
    const feature = readModelDeclaring(
      "requests:query:request-view:visible-to-me",
      "buyers see photos",
      { photos: createFilesField({ access: { read: ["Admin"] } }) },
    );
    expect(() => check(feature)).toThrow(/declares crossTenantFileRead, but its file field/);
  });
});

// The runtime finds crossTenantFileRead only on r.entity entities and on read models keyed by a
// single source stream that no r.entity registers; anywhere else the declaration does nothing.
describe("validateCrossTenantFileRead on a projection entity the file check never sees", () => {
  const QUERY = "requests:query:request-digest:visible-to-me";

  function digestEntity() {
    return createEntity({
      name: "request-digest",
      table: "cross_tenant_file_read_boot_request_digests",
      fields: { title: text(), photos: createFilesField() },
      crossTenantFileRead: { query: QUERY, reason: "buyers see photos" },
    });
  }

  function requestsFeature(
    register: (r: Parameters<Parameters<typeof defineFeature>[1]>[0]) => void,
  ) {
    return defineFeature("requests", (r) => {
      r.queryHandler({
        name: "request-digest:visible-to-me",
        schema: z.object({ id: z.string() }),
        handler: async () => null,
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      register(r);
    });
  }

  function boot(features: readonly FeatureDefinition[]): void {
    validateBoot(withBootValidatorFixture(features));
  }

  test("rejects it on a projection fed by several streams", () => {
    const entity = digestEntity();
    const feature = requestsFeature((r) => {
      r.defineEvent("request-received", z.object({}), { piiFields: "none" });
      r.projection({
        name: "request-digest",
        source: ["request-a", "request-b"],
        table: buildEntityTable(entity),
        entity,
        apply: { "requests:event:request-received": async () => {} },
      });
    });
    expect(() => boot([feature])).toThrow(
      /projection "request-digest" entity "request-digest" declares crossTenantFileRead, but the file check never sees it/,
    );
  });

  test("rejects it on a separate entity over the feature's own r.entity stream", () => {
    const entity = digestEntity();
    const feature = requestsFeature((r) => {
      r.entity(
        createEntity({ name: "request", table: "ctfr_requests", fields: { title: text() } }),
      );
      r.projection({
        name: "request-digest",
        source: "request",
        table: buildEntityTable(entity),
        entity,
        apply: { "request.created": async () => {} },
      });
    });
    expect(() => boot([feature])).toThrow(/declares crossTenantFileRead, but the file check never/);
  });

  test("rejects it on a projection over another feature's r.entity stream", () => {
    const entity = digestEntity();
    const intake = defineFeature("intake", (r) => {
      r.entity(
        createEntity({ name: "request", table: "ctfr_requests", fields: { title: text() } }),
      );
    });
    const feature = requestsFeature((r) => {
      r.projection({
        name: "request-digest",
        source: "request",
        table: buildEntityTable(entity),
        entity,
        apply: { "request.created": async () => {} },
      });
    });
    expect(() => boot([intake, feature])).toThrow(
      /declares crossTenantFileRead, but the file check never/,
    );
  });
});
