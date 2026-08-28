import { afterAll } from "bun:test";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeFileProviderContract } from "../../testing/file-provider-contract";
import { createLocalProvider } from "../local-provider";

const basePath = join(tmpdir(), `kumiko-local-provider-contract-${Date.now()}`);

describeFileProviderContract("LocalFileProvider", () => createLocalProvider(basePath));

afterAll(async () => {
  await rm(basePath, { recursive: true, force: true });
});
