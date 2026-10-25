import { describe, expect, test } from "bun:test";
import type { TreeNode } from "@cosmicdrift/kumiko-framework/engine";
import { legalPagesClient } from "../client-plugin.ts";

// Covers the three migration paths: attaching by navId, preventing leaks without
// navId, and unwrapping (the provider emits slug folders directly, NOT under a
// "Legal" wrapper—the App-r.nav node IS the container). legal-pages does not
// fetch, so the provider can be called directly.

function collect(
  provider: () => (emit: (n: readonly TreeNode[]) => void) => () => void,
): readonly TreeNode[] {
  let emitted: readonly TreeNode[] | undefined;
  const unsub = provider()((nodes) => {
    emitted = nodes;
  });
  unsub();
  if (emitted === undefined) throw new Error("provider emitted nothing");
  return emitted;
}

describe("legalPagesClient", () => {
  test("without navId: no navProvider (server-only consumers do not leak a Node)", () => {
    const def = legalPagesClient();
    expect(def.name).toBe("legal-pages");
    expect(def.navProviders).toBeUndefined();
  });

  test("with navId: provider is mounted under exactly this (pass-through) QN", () => {
    const navId = "publicstatus:nav:legal";
    const def = legalPagesClient({ navId });
    expect(Object.keys(def.navProviders ?? {})).toEqual([navId]);
  });

  test("Provider unwraps the legal container: top-level entries are the slug folders", () => {
    const navId = "publicstatus:nav:legal";
    const provider = legalPagesClient({ navId }).navProviders?.[navId];
    if (provider === undefined) throw new Error("provider missing");
    const emitted = collect(provider);

    // No "Legal" wrapper—the App node is the container.
    expect(emitted.some((n) => n.label === "Legal")).toBe(false);
    expect(emitted.length).toBeGreaterThan(0);

    // Each top-level node is a slug folder with language leaves that cross-link to
    // template-resolver:edit.
    const folder = emitted[0];
    expect(Array.isArray(folder?.children)).toBe(true);
    const langLeaf = Array.isArray(folder?.children) ? folder?.children[0] : undefined;
    expect(langLeaf?.target?.featureId).toBe("template-resolver");
    expect(langLeaf?.target?.action).toBe("edit");
  });
});
