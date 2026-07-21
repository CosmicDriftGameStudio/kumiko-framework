// createKumikoServer error / graceful-degradation paths — boot rejects,
// stylesheet pipeline failures, missing CSS route.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { createKumikoServer, type KumikoServerHandle } from "../create-kumiko-server";

const emptyFeature = defineFeature("dev-server-errors-probe", () => {});

let handle: KumikoServerHandle | undefined;

afterEach(async () => {
  if (handle) {
    await handle.stop();
    handle = undefined;
  }
});

describe("createKumikoServer — client bundle failure", () => {
  test("broken clientEntry rejects at boot with client bundle failed", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "kumiko-bundle-fail-"));
    const entry = join(tmpDir, "client.tsx");
    writeFileSync(entry, "const x = {{{\n");
    try {
      await expect(
        createKumikoServer({
          features: [emptyFeature],
          port: 0,
          installSignalHandlers: false,
          clientEntry: entry,
          stylesheet: false,
        }),
      ).rejects.toThrow(/client bundle failed|Bundle failed/);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("_buildBundle throw propagates at boot", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "kumiko-stub-fail-"));
    const entry = join(tmpDir, "client.tsx");
    writeFileSync(entry, "// noop\n");
    try {
      await expect(
        createKumikoServer({
          features: [emptyFeature],
          port: 0,
          installSignalHandlers: false,
          clientEntry: entry,
          stylesheet: false,
          _buildBundle: async () => {
            throw new Error("stub build blew up");
          },
        }),
      ).rejects.toThrow(/stub build blew up/);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
