// issue-1174: `bun create kumiko-app <name> --yes` resolves the recommended
// feature set through the manifest's `requires` graph (dep-resolver.ts), not
// through hand-written app composition. That graph can pull in a feature
// (here: user-data-rights, transitively via user-profile) whose boot-time
// obligations (an EXT_USER_DATA hook per PII entity) no OTHER auto-included
// feature satisfies — cli.test.ts's file-existence checks can't catch that,
// only actually booting the resolved set through validateBoot can.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { frameworkCoreEnvSchema } from "@cosmicdrift/kumiko-dev-server";
import { resolveKmsWiring } from "@cosmicdrift/kumiko-framework/crypto";
import {
  createRegistry,
  type FeatureDefinition,
  type TenantId,
  validateBoot as validateBootRaw,
} from "@cosmicdrift/kumiko-framework/engine";
import { composeEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-framework/testing";
import { runProdApp } from "@cosmicdrift/kumiko-server-runtime";
import { composeFeatures } from "@cosmicdrift/kumiko-server-runtime/compose-features";
import { resolveDeps } from "../dep-resolver";
import { FEATURE_CONSTRUCTORS } from "../feature-constructors";
import { runCreate } from "../index";
import { loadManifest } from "../manifest";
import { buildChoices } from "../picker";

function validateBoot(features: readonly FeatureDefinition[]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

async function instantiateResolved(names: readonly string[]): Promise<FeatureDefinition[]> {
  const instances: FeatureDefinition[] = [];
  for (const name of names) {
    const entry = FEATURE_CONSTRUCTORS[name];
    if (!entry) continue; // mirrors index.ts:47-49 — auto-mounted core deps have no entry
    const mod = (await import(entry.importPath)) as Record<string, unknown>;
    const exp = mod[entry.exportName];
    if (typeof exp === "function") {
      instances.push((exp as (...args: unknown[]) => FeatureDefinition)(...(entry.callArgs ?? [])));
    } else {
      instances.push(exp as FeatureDefinition);
    }
  }
  return instances;
}

describe("--yes resolved set boots (issue-1174 regression)", () => {
  const manifest = loadManifest();
  const recommended = buildChoices(manifest)
    .filter((c) => c.recommended)
    .map((c) => c.name);
  const resolved = resolveDeps(recommended, manifest);

  test("resolves user-data-rights-defaults alongside the transitively-pulled user-data-rights", () => {
    expect(resolved.featureNames).toContain("user-data-rights");
    expect(resolved.featureNames).toContain("user-data-rights-defaults");
  });

  test("the resolved --yes feature set boots without the GDPR PII-hook-coverage error", async () => {
    // sessions (auto-included) pulls auth-foundation; #1570 allows zero
    // tokenVerifier when sessionStore is mounted — PAT stays opt-in (#1514).
    expect(resolved.featureNames).not.toContain("personal-access-tokens");
    const instances = await instantiateResolved(resolved.featureNames);
    const composed = composeFeatures(instances, { includeBundled: true });
    expect(() => validateBoot(composed)).not.toThrow();
    expect(() => createRegistry(composed)).not.toThrow();
  });
});

// kumiko-framework#2330: validateBoot/createRegistry above never reach
// runProdApp's PII boot gate (assertPiiBootInvariants) — it's not part of
// validateBoot, it runs a step later. The --yes set mounts PII-annotated
// entities (user, tenant-invitation, fileRef via user-data-rights), so the
// generated bin/main.ts must wire kms/allowPlaintextPii or the first
// `bun run boot` throws BOOT ABORTED. This drives the SAME resolved feature
// set through the actual runProdApp (KUMIKO_DRY_RUN_ENV=boot — no DB/Redis
// connect) to pin both halves of the fix.
describe("--yes resolved set through runProdApp's PII boot gate (issue-2330 regression)", () => {
  const manifest = loadManifest();
  const recommended = buildChoices(manifest)
    .filter((c) => c.recommended)
    .map((c) => c.name);
  const resolved = resolveDeps(recommended, manifest);

  const auth = {
    admin: {
      email: "admin@test.local",
      password: "change-me-on-first-deploy",
      displayName: "Admin",
      memberships: [
        {
          tenantId: "93238e36-e2e5-4e2e-8be4-00004739a98c" as TenantId,
          tenantKey: "test",
          tenantName: "test",
          roles: ["TenantAdmin" as const],
        },
      ],
    },
  };

  async function bootWithWiring(wiring: Record<string, unknown>) {
    const instances = await instantiateResolved(resolved.featureNames);
    const bootFeatures = composeFeatures(instances, { includeBundled: true });
    const envSchema = composeEnvSchema({ core: frameworkCoreEnvSchema, features: bootFeatures });
    return runProdApp({
      features: instances,
      envSchema,
      autoListen: false,
      migrations: false,
      auth,
      envSource: {
        KUMIKO_DRY_RUN_ENV: "boot",
        JWT_SECRET: "a".repeat(32),
        KUMIKO_SECRETS_MASTER_KEY_V1: Buffer.alloc(32, 7).toString("base64"),
        DATABASE_URL: "postgres://dummy:dummy@127.0.0.1:1/dummy",
        REDIS_URL: "redis://127.0.0.1:1",
      },
      ...wiring,
    });
  }

  test("without kms/allowPlaintextPii wiring, boot aborts (pins the bug this issue reports)", async () => {
    await expect(bootWithWiring({})).rejects.toThrow(
      /BOOT ABORTED.*user.*tenant-invitation.*fileRef/s,
    );
  });

  test("with resolveKmsWiring's fallback (what the generated bin/main.ts now does), boot succeeds", async () => {
    // Empty object, not process.env: a dev machine with the real trio set
    // would otherwise flip this into the ActiveKmsWiring branch and the test
    // would stop exercising the plaintext fallback it's meant to pin.
    const kmsWiring = resolveKmsWiring(
      {},
      {
        logPrefix: "[test]",
        plaintextReason: "no PLATFORM_KEK / SUBJECT_KEYS_DATABASE_URL / KUMIKO_BLIND_INDEX_KEY set",
      },
    );
    expect(kmsWiring).toHaveProperty("allowPlaintextPii");
    const handle = await bootWithWiring(kmsWiring);
    expect(handle).toBeDefined();
  });

  test("generated .env.example's unset trio (empty string, not absent) still resolves to the plaintext fallback", async () => {
    // dotenv turns `PLATFORM_KEK=` into process.env.PLATFORM_KEK === "" — the
    // actual value a user gets from `cp .env.example .env` without filling it
    // in. resolveKmsWiring reads raw env (not the zod-validated envSchema),
    // and Boolean("") === Boolean(undefined), so this must behave identically
    // to the {} case above.
    const kmsWiring = resolveKmsWiring({
      PLATFORM_KEK: "",
      SUBJECT_KEYS_DATABASE_URL: "",
      KUMIKO_BLIND_INDEX_KEY: "",
    });
    expect(kmsWiring).toHaveProperty("allowPlaintextPii");
    const handle = await bootWithWiring(kmsWiring);
    expect(handle).toBeDefined();
  });
});

// The suite above rebuilds the wiring in-process and pins that the pieces
// are individually correct — it never imports the file scaffoldApp actually
// writes, so a typo in bin/main.ts's import specifier or a `...kmsWiring`
// spread landing in the wrong object literal would stay green. This drives
// the real generated bin/main.ts as a subprocess instead. Fixtures live
// under __tests__/.tmp-fixtures/ (gitignored, same trick as
// dev-server/src/codegen/__tests__/watch.test.ts) so Bun's node_modules
// walk-up from bin/main.ts still finds the repo's hoisted @cosmicdrift/*
// symlinks — a system tmpdir sits outside the workspace and can't resolve
// them (see walkthrough.integration.test.ts's comment on the same issue).
describe("generated bin/main.ts actually boots (issue-2330 regression, real subprocess)", () => {
  const FIXTURE_ROOT = join(import.meta.dir, ".tmp-fixtures");
  const createdDirs: string[] = [];

  afterAll(() => {
    for (const d of createdDirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        // ignore — best-effort
      }
    }
  });

  test("KUMIKO_DRY_RUN_ENV=boot bun bin/main.ts exits 0 against the file scaffoldApp wrote", async () => {
    mkdirSync(FIXTURE_ROOT, { recursive: true });
    const cwd = mkdtempSync(join(FIXTURE_ROOT, "boot-"));
    createdDirs.push(cwd);

    const exitCode = await runCreate({ name: "boot-fixture", yes: true, cwd, log: () => {} });
    expect(exitCode).toBe(0);

    const appDir = join(cwd, "boot-fixture");
    const proc = Bun.spawn({
      cmd: ["bun", "bin/main.ts"],
      cwd: appDir,
      env: {
        ...process.env,
        KUMIKO_DRY_RUN_ENV: "boot",
        JWT_SECRET: "a".repeat(32),
        KUMIKO_SECRETS_MASTER_KEY_V1: Buffer.alloc(32, 7).toString("base64"),
        DATABASE_URL: "postgres://dummy:dummy@127.0.0.1:1/dummy",
        REDIS_URL: "redis://127.0.0.1:1",
        // Pinned empty, not inherited from process.env: a dev machine with
        // the real trio set would otherwise flip resolveKmsWiring into the
        // ActiveKmsWiring branch (and its KMS health check) instead of the
        // plaintext fallback this test exercises.
        PLATFORM_KEK: "",
        SUBJECT_KEYS_DATABASE_URL: "",
        KUMIKO_BLIND_INDEX_KEY: "",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(code, `stdout:\n${stdout}\nstderr:\n${stderr}`).toBe(0);
    expect(`${stdout}${stderr}`).not.toContain("BOOT ABORTED");
    expect(stdout).toContain("boot validation OK");
  }, 30_000);
});
