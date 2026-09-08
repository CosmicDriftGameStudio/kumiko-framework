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

    // `builtForRoles` is caller provenance, not app shape — it differs by construction.
    expect({ ...adminManifest, builtForRoles: [] }).toEqual({
      ...viewerManifest,
      builtForRoles: [],
    });
  });

  // Fail-closed exposure against an undescribed registry is proven with a
  // synthetic one in
  // packages/bundled-features/src/agent-tools/__tests__/agent-manifest.test.ts.
  // What this app proves is the other direction: r.crud's per-verb
  // `descriptions` reach the manifest with the risk each verb resolves to.
  test("exposes every described CRUD verb with its resolved risk", () => {
    const registry = createRegistry([localeDe(), itemsFeature, demosFeature]);
    const manifest = buildAgentManifest(registry, { locale: "de", roles: ["admin"] });

    const byQn = new Map(manifest.handlers.map((handler) => [handler.qn, handler]));

    expect([...byQn.keys()].sort()).toEqual([
      "showcase:query:item:detail",
      "showcase:query:item:list",
      "showcase:write:item:create",
      "showcase:write:item:delete",
      "showcase:write:item:update",
    ]);
    expect(byQn.get("showcase:query:item:list")?.risk).toBe("low");
    expect(byQn.get("showcase:write:item:delete")?.risk).toBe("mid");
    expect(byQn.get("showcase:write:item:create")?.description).toBeTruthy();
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
