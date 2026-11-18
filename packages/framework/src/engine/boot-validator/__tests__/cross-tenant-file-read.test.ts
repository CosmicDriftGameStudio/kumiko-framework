import { describe, expect, test } from "bun:test";
import type { FieldDefinition } from "@cosmicdrift/kumiko-types/fields";
import * as z from "zod";
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
  validateCrossTenantFileRead(feature, buildQueryHandlerMap([feature]));
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
