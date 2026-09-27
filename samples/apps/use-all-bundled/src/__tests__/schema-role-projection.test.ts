// The role projection behind GET /api/schema must never hide something a
// role may see. Fixture tests can't prove that for real reference shapes
// (settings-hub navs, content collections, cross-feature navigate targets),
// so this runs it over every bundled feature: a caller holding every role
// that appears anywhere in the schema must get the unprojected schema back.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { configureEntityFieldEncryption } from "@cosmicdrift/kumiko-framework/db";
import {
  buildAppSchema,
  createRegistry,
  projectAppSchemaForRoles,
} from "@cosmicdrift/kumiko-framework/engine";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-framework/testing";
import type { AppSchema } from "@cosmicdrift/kumiko-framework/ui-types";
import { composeFeatures } from "@cosmicdrift/kumiko-server-runtime/compose-features";
import { APP_FEATURES, AUTH_COMPOSE_OPTIONS } from "../run-config";

beforeAll(() => {
  configureEntityFieldEncryption(createTestEnvelopeCipher());
});

afterAll(() => {
  configureEntityFieldEncryption(undefined);
});

function buildUseAllBundledSchema(): AppSchema {
  const registry = createRegistry(
    composeFeatures([...APP_FEATURES], { includeBundled: true, authOptions: AUTH_COMPOSE_OPTIONS }),
  );
  return buildAppSchema(registry);
}

function collectDeclaredRoles(value: unknown, into: Set<string>): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectDeclaredRoles(item, into);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      if (key === "roles" && Array.isArray(child)) {
        for (const role of child) if (typeof role === "string") into.add(role);
      }
      collectDeclaredRoles(child, into);
    }
  }
  return into;
}

describe("use-all-bundled schema role projection", () => {
  test("a caller holding every declared role gets the full schema, nothing dropped", () => {
    const fullSchema = buildUseAllBundledSchema();
    const everyRole = [...collectDeclaredRoles(fullSchema, new Set())];
    expect(everyRole.length).toBeGreaterThan(0);

    expect(projectAppSchemaForRoles(fullSchema, everyRole)).toBe(fullSchema);
  });

  test("the schema is actually role-gated, so the identity above is not vacuous", () => {
    const fullSchema = buildUseAllBundledSchema();
    const screenCount = (schema: AppSchema): number =>
      schema.features.reduce((sum, feature) => sum + feature.screens.length, 0);

    expect(screenCount(projectAppSchemaForRoles(fullSchema, []))).toBeLessThan(
      screenCount(fullSchema),
    );
  });
});
