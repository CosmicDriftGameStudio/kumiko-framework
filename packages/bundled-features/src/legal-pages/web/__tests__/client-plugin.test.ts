import { describe, expect, test } from "bun:test";
import type { TreeNode } from "@cosmicdrift/kumiko-framework/engine";
import { legalPagesClient } from "../client-plugin";

// Deckt die drei neuen Migrations-Pfade (advisor-Gap): navId-Attach,
// no-leak ohne navId, und der Unwrap (Provider emittiert die slug-Folder
// direkt, NICHT mehr unter einem "Legal"-Wrapper — der App-r.nav-Knoten
// IST der Container). legal-pages ist fetch-frei → Provider direkt aufrufbar.

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
  test("ohne navId: kein navProvider (server-only-Consumer leaken keinen Node)", () => {
    const def = legalPagesClient();
    expect(def.name).toBe("legal-pages");
    expect(def.navProviders).toBeUndefined();
  });

  test("mit navId: Provider hängt unter exakt dieser (pass-through) QN", () => {
    const navId = "publicstatus:nav:legal";
    const def = legalPagesClient({ navId });
    expect(Object.keys(def.navProviders ?? {})).toEqual([navId]);
  });

  test("Provider unwrappt den Legal-Container: Top-Level sind die slug-Folder", () => {
    const navId = "publicstatus:nav:legal";
    const provider = legalPagesClient({ navId }).navProviders?.[navId];
    if (provider === undefined) throw new Error("provider missing");
    const emitted = collect(provider);

    // Kein "Legal"-Wrapper mehr — der App-Knoten ist der Container.
    expect(emitted.some((n) => n.label === "Legal")).toBe(false);
    expect(emitted.length).toBeGreaterThan(0);

    // Jeder Top-Level-Knoten ist ein slug-Folder mit lang-Leaves, die per
    // Cross-Link auf text-content:edit zeigen.
    const folder = emitted[0];
    expect(Array.isArray(folder?.children)).toBe(true);
    const langLeaf = Array.isArray(folder?.children) ? folder?.children[0] : undefined;
    expect(langLeaf?.target?.featureId).toBe("text-content");
    expect(langLeaf?.target?.action).toBe("edit");
  });
});
