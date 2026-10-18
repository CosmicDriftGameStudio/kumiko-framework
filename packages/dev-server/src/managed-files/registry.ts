// One source for every file the framework owns in an app: the scaffold writes
// these renders, `kumiko check managed` compares against them and
// `kumiko sync-managed` writes them back.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJsonOrThrow } from "@cosmicdrift/kumiko-framework/utils";
import { BUNFIG_FILES, type BunfigOptions, renderBunfig } from "@cosmicdrift/kumiko-testing/bunfig";
import { isKebabSegment } from "../kebab.js";
import { readReleaseTarget, render, renderDeployFiles } from "../scaffold-deploy.js";
import { addManagedMarker, type MarkerCommentStyle } from "./marker.js";
import { readStaticAppConfig, type StaticAppConfig } from "./static-app-config.js";

export const BIOME_PRESET = "@cosmicdrift/kumiko-framework/biome";
export const TSCONFIG_PRESET = "@cosmicdrift/kumiko-framework/tsconfig.app.json";

export type ManagedAppInput = {
  readonly appRoot: string;
  /** Default: package.json `name`. */
  readonly appName?: string;
  /** kumiko.json uiRoots; a non-empty list turns on UI guards and DOM tests. */
  readonly uiRoots: readonly string[];
};

export type ManagedAppFacts = {
  readonly appRoot: string;
  readonly appName: string;
  readonly hasUi: boolean;
  readonly config: StaticAppConfig;
};

/** Byte-compared after the marker lines are stripped. */
export type ManagedTemplateFile = {
  readonly kind: "template";
  readonly path: string;
  /** Rendered content including the marker. */
  readonly content: string;
  readonly executable: boolean;
};

/** Compared after kumiko-testing's merge, which keeps app extras such as [install.scopes]. */
export type ManagedBunfigFile = {
  readonly kind: "bunfig";
  readonly path: string;
  readonly variant: "unit" | "integration" | "real" | "dom";
};

/** Must extend the framework preset; app overrides below `extends` are allowed. */
export type ManagedStructuralFile = {
  readonly kind: "structural";
  readonly path: "biome.json" | "tsconfig.json" | "kumiko.config.ts";
};

/** Written once by the scaffold, then owned by the app (wiring, env schema). */
export type ManagedSeedFile = {
  readonly kind: "seed";
  readonly path: string;
};

export type ManagedFile =
  | ManagedTemplateFile
  | ManagedBunfigFile
  | ManagedStructuralFile
  | ManagedSeedFile;

function templatesDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "templates", "managed");
}

function readTemplate(name: string): string {
  return readFileSync(join(templatesDir(), name), "utf-8");
}

function readPackageName(appRoot: string): string {
  const path = join(appRoot, "package.json");
  if (!existsSync(path)) throw new Error(`managed files: ${path} not found`);
  const raw = parseJsonOrThrow<unknown>(readFileSync(path, "utf-8"), path);
  const name = typeof raw === "object" && raw !== null && "name" in raw ? raw.name : undefined;
  if (typeof name !== "string") throw new Error(`managed files: ${path} has no "name"`);
  return name;
}

export function resolveManagedAppFacts(input: ManagedAppInput): ManagedAppFacts {
  const appName = input.appName ?? readPackageName(input.appRoot);
  // The name lands in workflow files, image names and shell scripts.
  if (!isKebabSegment(appName)) {
    throw new Error(`managed files: app name must be kebab-case (a-z, 0-9, -); got "${appName}"`);
  }
  return {
    appRoot: input.appRoot,
    appName,
    hasUi: input.uiRoots.length > 0,
    config: readStaticAppConfig(input.appRoot),
  };
}

function marked(
  path: string,
  body: string,
  style: MarkerCommentStyle,
  executable = false,
): ManagedTemplateFile {
  return { kind: "template", path, content: addManagedMarker(body, style), executable };
}

function renderCiWorkflow(facts: ManagedAppFacts): string {
  const infra = facts.config.kind === "defined" ? facts.config.ports.infra : undefined;
  const minio = infra?.s3 !== undefined;
  const meilisearch = infra?.meilisearch !== undefined;
  return render(
    readTemplate("ci.yml.template"),
    { appName: facts.appName, uiGuards: String(facts.hasUi) },
    { minio, meilisearch, e2eInputs: minio || meilisearch },
  );
}

export function renderManagedTemplates(facts: ManagedAppFacts): readonly ManagedTemplateFile[] {
  const deploy = renderDeployFiles({
    appName: facts.appName,
    destination: facts.appRoot,
    ensuredRegistryConfigFiles: [BUNFIG_FILES.unit],
  });
  const target = readReleaseTarget(facts.appRoot, facts.appName);
  return [
    ...deploy.files.map((file) =>
      marked(`deploy/${file.output}`, file.content, "#", file.output.endsWith(".sh")),
    ),
    marked(".husky/pre-push", readTemplate("husky-pre-push.template"), "#", true),
    marked(".github/workflows/cache-cleanup.yml", readTemplate("cache-cleanup.yml.template"), "#"),
    marked(
      ".github/workflows/release.yml",
      render(readTemplate("release.yml.template"), { appName: facts.appName, ...target }, {}),
      "#",
    ),
    marked(".github/workflows/ci.yml", renderCiWorkflow(facts), "#"),
    marked("kumiko/schema.ts", readTemplate("kumiko-schema.ts.template"), "//"),
  ];
}

export function managedBunfigFiles(facts: ManagedAppFacts): readonly ManagedBunfigFile[] {
  return [
    { kind: "bunfig", path: BUNFIG_FILES.unit, variant: "unit" },
    { kind: "bunfig", path: BUNFIG_FILES.integration, variant: "integration" },
    { kind: "bunfig", path: BUNFIG_FILES.real, variant: "real" },
    ...(facts.hasUi ? [{ kind: "bunfig", path: BUNFIG_FILES.dom, variant: "dom" } as const] : []),
  ];
}

/** Options are the app's choice; read them from the file so the check only flags real drift. */
export function renderManagedBunfig(file: ManagedBunfigFile, existing: string | undefined): string {
  const options: BunfigOptions = {
    ...(existing === undefined || /^linker = "hoisted"$/m.test(existing)
      ? { install: { linker: "hoisted" } }
      : {}),
    ...(existing !== undefined && /^coverage = true$/m.test(existing) ? { coverage: true } : {}),
  };
  return file.variant === "dom"
    ? renderBunfig("unit", { ...options, dom: true })
    : renderBunfig(file.variant, options);
}

export const MANAGED_STRUCTURAL_FILES: readonly ManagedStructuralFile[] = [
  { kind: "structural", path: "biome.json" },
  { kind: "structural", path: "tsconfig.json" },
  { kind: "structural", path: "kumiko.config.ts" },
];

export const MANAGED_SEED_FILES: readonly ManagedSeedFile[] = [
  { kind: "seed", path: "bin/server.ts" },
  { kind: "seed", path: "bin/env-schema.ts" },
];

export function listManagedFiles(facts: ManagedAppFacts): readonly ManagedFile[] {
  return [
    ...renderManagedTemplates(facts),
    ...managedBunfigFiles(facts),
    ...MANAGED_STRUCTURAL_FILES,
    ...MANAGED_SEED_FILES,
  ];
}

// Written the way Biome formats it, so the app's own `biome check` stays green.
export function renderBiomePresetJson(): string {
  return `{\n  "extends": [${JSON.stringify(BIOME_PRESET)}]\n}\n`;
}

export function renderTsconfigPresetJson(): string {
  return `${JSON.stringify(
    {
      extends: TSCONFIG_PRESET,
      include: ["bin", "src", "kumiko", "e2e", "kumiko.config.ts", "playwright.config.ts"],
    },
    null,
    2,
  )}\n`;
}
