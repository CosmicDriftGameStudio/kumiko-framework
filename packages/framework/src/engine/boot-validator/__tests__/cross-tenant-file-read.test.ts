import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { defineFeature } from "../../define-feature.ts";
import { createEntity, createTextField } from "../../factories.ts";
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

function featureDeclaring(query: string, reason: string): FeatureDefinition {
  return defineFeature("requests", (r) => {
    r.entity({
      name: "request",
      ...createEntity({
        table: "cross_tenant_file_read_boot_requests",
        fields: { title: text() },
        crossTenantFileRead: { query, reason },
      }),
    });
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
});
