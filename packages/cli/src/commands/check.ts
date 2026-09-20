import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { REPO_MANIFEST_FILE, type RepoManifest } from "@cosmicdrift/kumiko-repo-manifest";
import type { CliCommand, CliCommandContext } from "./types";

const APP_SCHEMA_FILE = "kumiko/schema.ts";

export type CheckStepId = "boot" | "guards" | "ui" | "checks";

export type CheckStep = {
  readonly id: CheckStepId;
  readonly label: string;
  readonly why: string;
};

export const CHECK_FLAGS = ["--explain"] as const;

/** Facts about the checked-out repo that the manifest does not state. */
export type RepoFacts = {
  /** A `kind: "app"` repo without one is an app by role only (an Astro site, a
   *  docs repo) — there is no composed feature set for validateBoot to check. */
  readonly hasAppSchema: boolean;
};

export function resolveCheckSteps(manifest: RepoManifest, facts: RepoFacts): readonly CheckStep[] {
  if (manifest.kind === "tooling") return [];
  const steps: CheckStep[] = [];
  if (manifest.kind === "app" && facts.hasAppSchema) {
    steps.push({
      id: "boot",
      label: "Boot validation",
      why: `kind "app" with ${APP_SCHEMA_FILE} — validateBoot over its composed FEATURES`,
    });
  }
  steps.push({
    id: "guards",
    label: "AST guards",
    why: `kind "${manifest.kind}" — sourceRoots ${manifest.sourceRoots.join(", ")}`,
  });
  if (manifest.uiRoots !== undefined && manifest.uiRoots.length > 0) {
    steps.push({
      id: "ui",
      label: "UI guards",
      why: `uiRoots ${manifest.uiRoots.join(", ")}`,
    });
  }
  steps.push({
    id: "checks",
    label: "Repo checks",
    why: `kind "${manifest.kind}" — testGlobs ${manifest.testGlobs.join(", ")}`,
  });
  return steps;
}

export type GuardsCli = Pick<
  typeof import("@cosmicdrift/kumiko-guards"),
  "cliFlagsError" | "findLocalRepo" | "runGuardsCli" | "runRepoChecksCli" | "runUiGuardsCli"
>;

export type SchemaCli = Pick<
  typeof import("@cosmicdrift/kumiko-framework/schema-cli"),
  "runSchemaCli"
>;

export type CheckDeps = {
  readonly loadGuards: () => Promise<GuardsCli>;
  readonly loadSchemaCli: () => Promise<SchemaCli>;
};

// Lazy: `kumiko new app` must not pay for ts-morph or the framework runtime.
const DEFAULT_DEPS: CheckDeps = {
  loadGuards: () => import("@cosmicdrift/kumiko-guards"),
  loadSchemaCli: () => import("@cosmicdrift/kumiko-framework/schema-cli"),
};

export async function runCheck(
  ctx: CliCommandContext,
  deps: CheckDeps = DEFAULT_DEPS,
): Promise<number> {
  // The guard runners resolve their scan root from the ambient cwd — a diverging
  // ctx.cwd would print the step list of one repo and scan another.
  if (resolve(ctx.cwd) !== resolve(process.cwd())) {
    ctx.out.err("");
    ctx.out.err(`  kumiko check runs against the process cwd (${process.cwd()}).`);
    ctx.out.err(`  Got cwd: ${ctx.cwd}`);
    ctx.out.err("");
    return 1;
  }

  let guards: GuardsCli;
  try {
    guards = await deps.loadGuards();
  } catch (e) {
    ctx.out.err("");
    ctx.out.err("  ✗ @cosmicdrift/kumiko-guards could not be loaded — kumiko check needs it.");
    ctx.out.err(`    ${e instanceof Error ? e.message : String(e)}`);
    ctx.out.err("    Fix: `bun add -d @cosmicdrift/kumiko-guards`");
    ctx.out.err("");
    return 1;
  }

  const flagsError = guards.cliFlagsError("check", ctx.argv, CHECK_FLAGS);
  if (flagsError !== undefined) {
    ctx.out.err("");
    ctx.out.err(`  ${flagsError}`);
    ctx.out.err("");
    return 1;
  }

  let repo: ReturnType<GuardsCli["findLocalRepo"]>;
  try {
    repo = guards.findLocalRepo(ctx.cwd);
  } catch (e) {
    ctx.out.err("");
    ctx.out.err(`  ✗ ${e instanceof Error ? e.message : String(e)}`);
    ctx.out.err("");
    return 1;
  }
  if (repo === undefined) {
    ctx.out.err("");
    ctx.out.err(`  ✗ No Kumiko repo above ${ctx.cwd}.`);
    ctx.out.err(`    Add a ${REPO_MANIFEST_FILE} at the repo root (kind, sourceRoots, testGlobs).`);
    ctx.out.err("");
    return 1;
  }

  const steps = resolveCheckSteps(repo.manifest, {
    hasAppSchema: existsSync(join(repo.absPath, APP_SCHEMA_FILE)),
  });
  ctx.out.log("");
  ctx.out.log(
    `  ${repo.name} — kind "${repo.manifest.kind}", ${steps.length} step(s) from ${REPO_MANIFEST_FILE}`,
  );
  for (const step of steps) {
    ctx.out.log(`    ${step.id.padEnd(8)}${step.label} — ${step.why}`);
  }
  ctx.out.log("");

  if (steps.length === 0) {
    ctx.out.log(`  Nothing to check: kind "${repo.manifest.kind}" declares no product code.`);
    ctx.out.log("");
    return 0;
  }

  if (ctx.argv.includes("--explain")) {
    // The guard suite is the only one with its own --explain; pass it through.
    if (steps.some((step) => step.id === "guards")) guards.runGuardsCli(["--explain"]);
    return 0;
  }

  let failed = 0;
  for (const step of steps) {
    ctx.out.log(`  ▸ ${step.label}`);
    failed += await runStep(step.id, ctx, guards, deps);
  }
  return failed > 0 ? 1 : 0;
}

async function runStep(
  id: CheckStepId,
  ctx: CliCommandContext,
  guards: GuardsCli,
  deps: CheckDeps,
): Promise<number> {
  switch (id) {
    case "boot": {
      const { runSchemaCli } = await deps.loadSchemaCli();
      return await runSchemaCli(["validate"], ctx.cwd, ctx.out);
    }
    case "guards":
      return guards.runGuardsCli([]);
    case "ui":
      return guards.runUiGuardsCli([]);
    case "checks":
      return await guards.runRepoChecksCli([]);
  }
}

export const checkCommand: CliCommand = {
  id: "check",
  description: "Boot validation + guard suites, step list derived from kumiko.json",
  help: [
    `Derives the step list from ${REPO_MANIFEST_FILE} instead of a hand-written command chain:`,
    "",
    `  boot     kind "app" + ${APP_SCHEMA_FILE}   validateBoot over its composed FEATURES`,
    '  guards   kind != "tooling"     AST guards over sourceRoots',
    "  ui       uiRoots declared      UI guards (App-Mounting 2.0)",
    '  checks   kind != "tooling"     repo checks over sourceRoots + testGlobs',
    "",
    "Flags:",
    "  --explain    print the resolved step list and the guards' own scan explanation, run nothing",
  ].join("\n"),
  run: (ctx) => runCheck(ctx),
};
