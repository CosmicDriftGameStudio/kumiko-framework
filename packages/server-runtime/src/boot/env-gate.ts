import { SECRETS_MASTER_KEK_ENV_KEYS } from "@cosmicdrift/kumiko-bundled-features/secrets";
import { resolvePlatformKeks } from "@cosmicdrift/kumiko-framework/crypto";
import {
  type ComposedEnvSchema,
  type EnvFieldInspection,
  inspectEnv,
  KumikoBootError,
  kmsSlotsOf,
  parseEnv,
  withOptionalEnvKeys,
} from "@cosmicdrift/kumiko-framework/env";
import {
  DRY_RUN_ENV_VAR,
  type DryRunEnvMode,
  type DryRunMode,
  parseDryRunEnvMode,
  renderDryRun,
  renderEnvInspection,
} from "@cosmicdrift/kumiko-framework/env/dry-run";
import type { MasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import { withBootOptionEnvBlocks } from "../boot-options/option-env-schema.ts";
import type { BootOptionFields } from "../boot-options/resolve-boot-options.ts";

export type RunMode = DryRunEnvMode;

// `boot` is the smoke-test path: validators run, no DB/Redis connect, exit
// after the registry build. Render modes (human|json|pulumi|k8s|1) inspect the
// env schema and exit before any feature wiring.
export function parseRunMode(raw: string | undefined, processName = "runProdApp"): RunMode | null {
  const mode = parseDryRunEnvMode(raw);
  if (mode !== undefined) return mode;
  if (raw) {
    // biome-ignore lint/suspicious/noConsole: boot-time warn for typo discovery
    console.warn(
      `[${processName}] ${DRY_RUN_ENV_VAR}="${raw}" unrecognized ` +
        `(expected 1|human|json|pulumi|k8s|boot); continuing with normal boot.`,
    );
  }
  return null;
}

function isRenderMode(mode: RunMode | null): mode is DryRunMode {
  return mode !== null && mode !== "boot";
}

function defaultBootErrorReporter(err: KumikoBootError): never {
  // biome-ignore lint/suspicious/noConsole: boot-time error, no logger configured yet
  console.error(err.format());
  process.exit(1);
}

// The boot dry run lists these even when the app schema leaves them out
// (JWT_SECRET usually comes from auth-email-password).
const RUNTIME_REQUIRED_ENV_KEYS = ["DATABASE_URL", "REDIS_URL", "JWT_SECRET"] as const;

function inspectUndeclaredRuntimeEnv(
  declaredShape: Readonly<Record<string, unknown>>,
  env: Readonly<Record<string, string | undefined>>,
): readonly EnvFieldInspection[] {
  return RUNTIME_REQUIRED_ENV_KEYS.filter((name) => !(name in declaredShape)).map(
    (name): EnvFieldInspection => ({
      name,
      klass: "required",
      source: "server-runtime",
      status: env[name] ? "set" : "missing",
    }),
  );
}

function requireEnvSchema(
  envSchema: ComposedEnvSchema | undefined,
  processName: string,
): ComposedEnvSchema {
  if (envSchema === undefined) {
    throw new KumikoBootError([
      {
        name: "envSchema",
        kind: "missing",
        message: `${processName} needs envSchema. Pass composeEnvSchema({ core: frameworkCoreEnvSchema, features, extend }): composeEnvSchema from @cosmicdrift/kumiko-framework/env, frameworkCoreEnvSchema from @cosmicdrift/kumiko-dev-server/env-schema, features the same list as ${processName}'s.`,
      },
    ]);
  }
  return envSchema;
}

export type EnvGateOptions = BootOptionFields & {
  readonly envSchema: ComposedEnvSchema | undefined;
  readonly envSource?: Record<string, string | undefined>;
  readonly masterKey?: MasterKeyProvider;
  readonly pulumiPrefix?: string;
  readonly bootErrorReporter?: (err: KumikoBootError) => void;
};

export type EnvGateResult =
  | { readonly kind: "stopped" }
  | {
      readonly kind: "ready";
      readonly runMode: RunMode | null;
      readonly decryptedEnvSource: Record<string, string | undefined>;
    };

/** Env schema parse, dry-run output and KEK-slot decryption, in front of any boot work.
 *  `stopped` means a dry-run mode produced its output and the caller returns an inert handle. */
export async function runEnvGate(
  options: EnvGateOptions,
  processName: string,
): Promise<EnvGateResult> {
  const rawEnvSource = options.envSource ?? process.env;
  const runMode = parseRunMode(rawEnvSource[DRY_RUN_ENV_VAR], processName);
  const composedEnvSchema = withBootOptionEnvBlocks(
    requireEnvSchema(options.envSchema, processName),
    options,
  );
  const effectiveEnvSchema = options.masterKey
    ? withOptionalEnvKeys(composedEnvSchema.schema, SECRETS_MASTER_KEK_ENV_KEYS)
    : composedEnvSchema.schema;
  const reportBootError = (err: KumikoBootError): void => {
    const reporter = options.bootErrorReporter ?? defaultBootErrorReporter;
    reporter(err);
  };
  const validateEnv = (source: Record<string, string | undefined>): void => {
    try {
      parseEnv(effectiveEnvSchema, source, {
        sources: composedEnvSchema.sources,
        ...(options.pulumiPrefix ? { pulumiPrefix: options.pulumiPrefix } : {}),
      });
    } catch (err) {
      if (err instanceof KumikoBootError) reportBootError(err);
      throw err;
    }
  };
  if (isRenderMode(runMode)) {
    // biome-ignore lint/suspicious/noConsole: dry-run output IS the deliverable
    console.log(
      renderDryRun(composedEnvSchema, runMode, {
        ...(options.pulumiPrefix ? { pulumiPrefix: options.pulumiPrefix } : {}),
        sources: composedEnvSchema.sources,
      }),
    );
    // Tests inject envSource and want a return value, not an exit.
    if (options.envSource === undefined) {
      process.exit(0);
    }
    return { kind: "stopped" };
  }
  if (runMode === "boot") {
    const inspection = [
      ...inspectEnv(effectiveEnvSchema, rawEnvSource, { sources: composedEnvSchema.sources }),
      ...inspectUndeclaredRuntimeEnv(effectiveEnvSchema.shape, rawEnvSource),
    ];
    // biome-ignore lint/suspicious/noConsole: boot-mode output IS the deliverable
    console.log(renderEnvInspection(inspection));
    if (inspection.some((row) => row.status === "invalid")) {
      // Missing rows go into the same report: the run fails anyway, so the
      // operator sees every variable to fix in one pass.
      reportBootError(
        new KumikoBootError(
          inspection.flatMap((row) =>
            row.status === "invalid" || row.status === "missing"
              ? [
                  {
                    name: row.name,
                    kind: row.status,
                    message:
                      row.message ?? (row.status === "missing" ? "missing" : "invalid value"),
                    source: row.source,
                  },
                ]
              : [],
          ),
        ),
      );
      return { kind: "stopped" };
    }
    // A build pipeline has no deploy secrets: the inventory is the result,
    // and the wiring check needs every value, so it stops here.
    if (inspection.some((row) => row.status === "missing")) {
      if (options.envSource === undefined) {
        process.exit(0);
      }
      return { kind: "stopped" };
    }
  }
  // boot-mode with a complete env AND normal boot run the full validation,
  // including object-level refinements the per-field check skips.
  validateEnv(rawEnvSource);

  // Slots the schema marks `kms` are decrypted once here so every consumer
  // below sees the same resolved env.
  const kmsSlots = kmsSlotsOf(composedEnvSchema.schema);
  const decryptedEnvSource = await resolvePlatformKeks(rawEnvSource, {
    slots: kmsSlots,
    logPrefix: `[${processName}]`,
  });
  // The first parse relaxes ciphertext-only slots, so their decrypted
  // plaintext never met the slot's own validators (.regex/.min/.refine).
  if (
    kmsSlots.some(
      (slot) => rawEnvSource[slot] === undefined && decryptedEnvSource[slot] !== undefined,
    )
  ) {
    validateEnv(decryptedEnvSource);
  }
  return { kind: "ready", runMode, decryptedEnvSource };
}
