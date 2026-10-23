import { join } from "node:path";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { Registry } from "@cosmicdrift/kumiko-framework/engine";
import { CLI_KMS_SLOTS } from "../kms-wiring";
import { loadAppConfig } from "../load-app-config";
import type { CliCommandContext } from "../types";

const BACKFILL_PII_FLAGS = [
  "--dry-run",
  "--rebuild",
  "--resolve-owner-from-projection",
  "--rekey-tenant-keyed-owner-fields",
  "--erase-unresolvable-subjects",
] as const;
type BackfillPiiFlag = (typeof BACKFILL_PII_FLAGS)[number];

function isBackfillPiiFlag(value: string): value is BackfillPiiFlag {
  return BACKFILL_PII_FLAGS.some((flag) => flag === value);
}

export type BackfillPiiArgs =
  | { readonly mode: "rebuild" }
  | {
      readonly mode: "backfill";
      readonly dryRun: boolean;
      readonly resolveOwnerFromProjection: boolean;
      readonly rekeyTenantKeyedOwnerFields: boolean;
      readonly eraseUnresolvableSubjects: boolean;
    };

// A typo such as `--dryrun` must fail instead of silently running the real
// backfill. The rebuild is a separate invocation on purpose: it may only run
// once the backfill (and any forget-subject follow-up) has completed, and an
// erasing run must never propagate into the read side unchecked.
export function parseBackfillPiiArgs(argv: readonly string[]): BackfillPiiArgs {
  const flags = new Set<BackfillPiiFlag>();
  for (const arg of argv) {
    if (!isBackfillPiiFlag(arg)) throw new Error(`unknown flag: ${arg}`);
    flags.add(arg);
  }
  if (flags.has("--rebuild")) {
    if (flags.size > 1) {
      throw new Error("--rebuild runs the projection rebuild only and takes no other flag");
    }
    return { mode: "rebuild" };
  }
  return {
    mode: "backfill",
    dryRun: flags.has("--dry-run"),
    resolveOwnerFromProjection: flags.has("--resolve-owner-from-projection"),
    rekeyTenantKeyedOwnerFields: flags.has("--rekey-tenant-keyed-owner-fields"),
    eraseUnresolvableSubjects: flags.has("--erase-unresolvable-subjects"),
  };
}

// Must match backfillEventPiiEncryption's target set; rebuilding more would
// shadow-swap tables the backfill never touched.
export function selectPiiProjections<
  P extends { readonly name: string; readonly sources: readonly string[] },
>(
  registry: Registry,
  projections: readonly P[],
  piiDeps: {
    readonly collectPiiSubjectFields: typeof import("@cosmicdrift/kumiko-framework/crypto").collectPiiSubjectFields;
    readonly configuredEventPiiCatalog: typeof import("@cosmicdrift/kumiko-framework/crypto").configuredEventPiiCatalog;
  },
): P[] {
  const piiEntityNames = new Set<string>();
  for (const [name, entity] of registry.getAllEntities()) {
    if (piiDeps.collectPiiSubjectFields(entity).length > 0) piiEntityNames.add(name);
  }
  const piiEventTypes = new Set(piiDeps.configuredEventPiiCatalog().keys());
  const sourceCarriesPii = (source: string): boolean => {
    if (piiEntityNames.has(source) || piiEventTypes.has(source)) return true;
    // "<entity>.<event>" sources; a dotless source must not be truncated.
    const dot = source.lastIndexOf(".");
    return dot > 0 && piiEntityNames.has(source.slice(0, dot));
  };
  // Event-sourced aggregates without an entity only show up through the
  // catalog event types their projection applies.
  const appliesPiiEvent = (projectionName: string): boolean =>
    Object.keys(registry.getAllProjections().get(projectionName)?.apply ?? {}).some((eventType) =>
      piiEventTypes.has(eventType),
    );
  return projections.filter((p) => p.sources.some(sourceCarriesPii) || appliesPiiEvent(p.name));
}

const LOG_PREFIX = "[backfill-pii]";

const BIGINT_SAFE = (_key: string, value: unknown): unknown =>
  typeof value === "bigint" ? String(value) : value;

export const BACKFILL_PII_HELP = [
  "Re-encrypts pre-KMS plaintext PII in the event store, then (separately)",
  "rebuilds the projections that read it. Reads kumiko.config.ts in cwd.",
  "",
  "Env: DATABASE_URL, SUBJECT_KEYS_DATABASE_URL, PLATFORM_KEK (or",
  "PLATFORM_KEK_CIPHERTEXT + PLATFORM_KEK_KMS_KEY_ID + PLATFORM_KEK_KMS_TOKEN),",
  "KUMIKO_BLIND_INDEX_KEY, optional PLATFORM_KEK_VERSION / _PREVIOUS / _PREVIOUS_VERSION.",
  "",
  "Flags:",
  "  --dry-run                          scan and count only",
  "  --resolve-owner-from-projection    owner missing in old payloads: read it from the projection",
  "  --rekey-tenant-keyed-owner-fields  move tenant-keyed owner fields under the resolved owner",
  "  --erase-unresolvable-subjects      erase fields whose subject stays unresolvable (irreversible)",
  "  --rebuild                          rebuild the PII projections only; run after the backfill",
].join("\n");

type PiiDeps = Parameters<typeof selectPiiProjections>[2];
type BackfillArgs = Extract<BackfillPiiArgs, { readonly mode: "backfill" }>;

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function rebuildPiiProjections(
  ctx: CliCommandContext,
  db: DbConnection,
  registry: Registry,
  piiDeps: PiiDeps,
): Promise<number> {
  const { listProjectionsWithState, rebuildProjection } = await import(
    "@cosmicdrift/kumiko-framework/pipeline"
  );
  const all = await listProjectionsWithState(db, registry, { includeImplicit: true });
  const rebuildFailures: string[] = [];
  for (const projection of selectPiiProjections(registry, all, piiDeps)) {
    try {
      const result = await rebuildProjection(projection.name, { db, registry });
      ctx.out.log(
        `${LOG_PREFIX} rebuilt ${projection.name}: ${JSON.stringify(result, BIGINT_SAFE)}`,
      );
    } catch (e) {
      // One broken projection must not block the remaining rebuilds.
      rebuildFailures.push(`${projection.name}: ${errorMessage(e)}`);
      ctx.out.err(`${LOG_PREFIX} REBUILD FAILED ${projection.name}`);
    }
  }
  if (rebuildFailures.length === 0) return 0;
  ctx.out.err(
    `${LOG_PREFIX} ${rebuildFailures.length} rebuild(s) failed:\n${rebuildFailures.join("\n")}`,
  );
  return 1;
}

async function backfillPii(
  ctx: CliCommandContext,
  db: DbConnection,
  registry: Registry,
  args: BackfillArgs,
): Promise<number> {
  const { backfillEventPiiEncryption } = await import("@cosmicdrift/kumiko-framework/event-store");
  const result = await backfillEventPiiEncryption(db, registry, {
    dryRun: args.dryRun,
    resolveOwnerFromProjection: args.resolveOwnerFromProjection,
    rekeyTenantKeyedOwnerFields: args.rekeyTenantKeyedOwnerFields,
    eraseUnresolvableSubjects: args.eraseUnresolvableSubjects,
  });
  ctx.out.log(
    `${LOG_PREFIX}${args.dryRun ? " DRY-RUN" : ""} ${JSON.stringify(result, BIGINT_SAFE, 2)}`,
  );
  if (result.erasedUnresolvable > 0) {
    // Erasure is irreversible; a separate line so it cannot hide in the JSON above.
    ctx.out.err(
      `${LOG_PREFIX} WARNING: ${result.erasedUnresolvable} unresolvable subject(s) ${args.dryRun ? "would be" : "were"} erased — compare against the dry-run count before running --rebuild.`,
    );
  }
  if (result.failures.length > 0) {
    ctx.out.err(
      `${LOG_PREFIX} ${result.failures.length} events failed — nothing skipped silently, rerun after inspecting.`,
    );
    return 1;
  }
  if (!args.dryRun) ctx.out.log(`${LOG_PREFIX} next: kumiko ops backfill-pii --rebuild`);
  return 0;
}

export async function runBackfillPii(ctx: CliCommandContext): Promise<number> {
  let args: BackfillPiiArgs;
  try {
    args = parseBackfillPiiArgs(ctx.argv);
  } catch (e) {
    ctx.out.err(`${LOG_PREFIX} ${errorMessage(e)}`);
    ctx.out.err(BACKFILL_PII_HELP);
    return 1;
  }

  const configPath = join(ctx.cwd, "kumiko.config.ts");
  if (!(await Bun.file(configPath).exists())) {
    ctx.out.err(`${LOG_PREFIX} kumiko.config.ts not found at: ${configPath}`);
    return 1;
  }
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    ctx.out.err(`${LOG_PREFIX} DATABASE_URL not set. Run against the app env.`);
    return 1;
  }

  const { ensureTemporalPolyfill } = await import("@cosmicdrift/kumiko-framework/time");
  await ensureTemporalPolyfill();

  const config = await loadAppConfig(ctx, configPath);
  if (config === null) return 1;

  const crypto = await import("@cosmicdrift/kumiko-framework/crypto");
  const { createRegistry } = await import("@cosmicdrift/kumiko-framework/engine");
  const { createDbConnection } = await import("@cosmicdrift/kumiko-framework/db");

  // Without the full KMS wiring the backfill would have nothing to encrypt
  // under, so there is deliberately no plaintext fallback here.
  let wiring: Awaited<ReturnType<typeof crypto.requireKmsWiringAsync>>;
  try {
    wiring = await crypto.requireKmsWiringAsync(process.env, {
      logPrefix: LOG_PREFIX,
      slots: CLI_KMS_SLOTS,
      log: (line) => ctx.out.log(line),
    });
  } catch (e) {
    ctx.out.err(errorMessage(e));
    return 1;
  }
  try {
    crypto.configurePiiSubjectKms(wiring.kms);
    crypto.configureBlindIndexKey(wiring.blindIndexKey);
    const registry = createRegistry(config.features);
    const { db, close } = createDbConnection({
      url: databaseUrl,
      maxConnections: 4,
      rowLevelSecurity: "off", // operator backfill, no tenant scope
    });
    try {
      return args.mode === "rebuild"
        ? await rebuildPiiProjections(ctx, db, registry, crypto)
        : await backfillPii(ctx, db, registry, args);
    } finally {
      await close();
    }
  } catch (e) {
    ctx.out.err(`${LOG_PREFIX} ${errorMessage(e)}`);
    return 1;
  } finally {
    // The KMS pool keeps the process alive otherwise.
    await wiring.close();
  }
}

export const backfillPiiOp = {
  id: "backfill-pii",
  description: "Encrypt pre-KMS plaintext PII in the event store",
  run: runBackfillPii,
} as const;
