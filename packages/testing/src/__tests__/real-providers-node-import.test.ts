import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  isRealProviderRun,
  REAL_PROVIDERS_ENV,
  requireRealProviders,
} from "@cosmicdrift/kumiko-framework/testing/real-providers";
import * as z from "zod";
import {
  REAL_PROVIDERS_ENV as E2E_REAL_PROVIDERS_ENV,
  isRealProviderRun as e2eIsRealProviderRun,
  requireRealProviders as e2eRequireRealProviders,
} from "../e2e";

const realProvidersNodeProbeResultSchema = z.object({
  env: z.string(),
  run: z.boolean(),
  off: z.boolean(),
  requireType: z.string(),
});

describe("real-providers subpath", () => {
  test("the real-providers subpath loads under plain Node", async () => {
    const source = `
      import { REAL_PROVIDERS_ENV, isRealProviderRun, requireRealProviders } from "@cosmicdrift/kumiko-framework/testing/real-providers";
      console.log(JSON.stringify({
        env: REAL_PROVIDERS_ENV,
        run: isRealProviderRun({ [REAL_PROVIDERS_ENV]: "1" }),
        off: isRealProviderRun({}),
        requireType: typeof requireRealProviders,
      }));
    `;
    const packagesTestingDir = join(import.meta.dir, "..", "..");
    const { exitCode, stdout, stderr } = Bun.spawnSync(
      ["node", "--input-type=module", "-e", source],
      {
        cwd: packagesTestingDir,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const decodedStderr = stderr.toString();

    expect({ exitCode, stderr: decodedStderr }).toEqual({
      exitCode: 0,
      stderr: expect.any(String),
    });
    expect(realProvidersNodeProbeResultSchema.parse(JSON.parse(stdout.toString()))).toEqual({
      env: "KUMIKO_REAL_PROVIDERS",
      run: true,
      off: false,
      requireType: "function",
    });
  });

  test("the e2e barrel re-exports the very same bindings as the framework subpath", () => {
    expect(e2eIsRealProviderRun).toBe(isRealProviderRun);
    expect(e2eRequireRealProviders).toBe(requireRealProviders);
    expect(E2E_REAL_PROVIDERS_ENV).toBe(REAL_PROVIDERS_ENV);
  });
});
