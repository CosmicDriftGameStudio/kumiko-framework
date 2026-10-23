import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import frameworkManifest from "../../../package.json" with { type: "json" };
import { MEILISEARCH_PEER } from "../../search/meilisearch-peer.ts";
import { importOptionalPeer } from "../import-optional-peer.ts";

const MISSING = "kumiko-missing-peer-probe";
const peer = { name: MISSING, range: "^1.2.3", requiredBy: "@scope/pkg/sub" };

describe("importOptionalPeer", () => {
  test("a really missing peer becomes an actionable error with the cause kept", async () => {
    const probe = MISSING;
    const failure = await importOptionalPeer(peer, (): Promise<unknown> => import(probe)).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    if (!(failure instanceof Error)) throw failure;
    expect(failure.message).toBe(
      `${MISSING} is not installed. @scope/pkg/sub needs it as a peer dependency: bun add ${MISSING}@^1.2.3`,
    );
    expect(failure.cause).toBeInstanceOf(Error);
  });

  test("a module that itself imports another missing package keeps its original error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "optional-peer-"));
    try {
      const file = join(dir, "peer.mjs");
      writeFileSync(file, 'import "kumiko-missing-transitive-probe";\n');
      const failure = await importOptionalPeer(
        { ...peer, name: "present-peer" },
        (): Promise<unknown> => import(file),
      ).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      if (!(failure instanceof Error)) throw failure;
      expect(failure.message).toContain("kumiko-missing-transitive-probe");
      expect(failure.message).not.toContain("is not installed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("any other importer error passes through unchanged", async () => {
    const original = new Error("boom");
    const failure = await importOptionalPeer(peer, () => Promise.reject(original)).catch(
      (error: unknown) => error,
    );
    expect(failure).toBe(original);
  });

  test("returns the module on success", async () => {
    const loaded = await importOptionalPeer(peer, () => Promise.resolve({ ok: true }));
    expect(loaded).toEqual({ ok: true });
  });
});

describe("MEILISEARCH_PEER", () => {
  test("range matches the peerDependencies entry in package.json", () => {
    expect(MEILISEARCH_PEER.range).toBe(frameworkManifest.peerDependencies.meilisearch);
  });
});
