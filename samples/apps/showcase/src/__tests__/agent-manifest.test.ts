import { describe, expect, test } from "bun:test";
import { buildAgentManifest } from "@cosmicdrift/kumiko-bundled-features/agent-tools";
import { createRegistry } from "@cosmicdrift/kumiko-framework/engine";
import { localeDe } from "@cosmicdrift/kumiko-locale-de";
import { demosFeature } from "../features/demos";
import { itemsFeature } from "../features/items";

describe("buildAgentManifest against the showcase app", () => {
  test("matches the recorded snapshot", () => {
    const registry = createRegistry([localeDe(), itemsFeature, demosFeature]);
    const manifest = buildAgentManifest(registry, { locale: "de", roles: ["admin"] });

    expect(manifest).toMatchSnapshot();
  });

  // Showcase is deliberately auth-free — every handler/screen/nav uses
  // `openToAll` (see src/app/server.ts) — so the manifest must come out
  // identical regardless of caller role. Role-FILTERING itself is covered
  // against a role-gated feature in
  // packages/bundled-features/src/agent-tools/__tests__/agent-manifest.test.ts.
  test("is role-independent because showcase gates nothing", () => {
    const registry = createRegistry([localeDe(), itemsFeature, demosFeature]);
    const adminManifest = buildAgentManifest(registry, { locale: "de", roles: ["admin"] });
    const viewerManifest = buildAgentManifest(registry, { locale: "de", roles: ["viewer"] });

    expect(adminManifest).toEqual(viewerManifest);
  });

  // No showcase handler carries a `description` today, so fail-closed
  // exposure keeps every one of them out of the manifest — proof for D8.
  // This will start filling in once #2615 adds descriptions to the
  // bundled CRUD handlers.
  test("has no exposed handlers yet", () => {
    const registry = createRegistry([localeDe(), itemsFeature, demosFeature]);
    const manifest = buildAgentManifest(registry, { locale: "de", roles: ["admin"] });

    expect(manifest.handlers).toEqual([]);
  });

  test("includes the item entity with field labels in both de and en", () => {
    const registry = createRegistry([localeDe(), itemsFeature, demosFeature]);
    const manifest = buildAgentManifest(registry, { locale: "de", roles: ["admin"] });

    const item = manifest.entities.find((entity) => entity.name === "item");
    expect(item).toBeDefined();

    const titleField = item?.fields.find((field) => field.name === "title");
    expect(titleField?.labels).toMatchObject({ de: "Titel", en: "Title" });
  });
});
