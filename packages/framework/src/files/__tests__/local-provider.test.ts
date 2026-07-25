import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalProvider } from "../local-provider";

describe("createLocalProvider path-traversal guard", () => {
  const basePath = join(tmpdir(), `kumiko-local-provider-test-${Date.now()}`);
  const provider = createLocalProvider(basePath);

  afterEach(async () => {
    await rm(basePath, { recursive: true, force: true });
  });

  test("rejects a key with a `..` segment even when it resolves inside basePath", async () => {
    await expect(
      provider.write("T1/e/1/f/x.png/../../../../T2/y.png", new Uint8Array([1])),
    ).rejects.toThrow(/path-traversal/);
  });

  test("rejects a `..` segment on read/delete too, and exists() reports false instead of throwing", async () => {
    await expect(provider.read("a/../../etc/passwd")).rejects.toThrow(/path-traversal/);
    await expect(provider.delete("a/../../etc/passwd")).rejects.toThrow(/path-traversal/);
    expect(await provider.exists("a/../../etc/passwd")).toBe(false);
  });

  test("still allows a normal, contained key", async () => {
    await provider.write("T1/entity/1/field/file.png", new Uint8Array([1, 2, 3]));
    expect(await provider.exists("T1/entity/1/field/file.png")).toBe(true);
  });
});
