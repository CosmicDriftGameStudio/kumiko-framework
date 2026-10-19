import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { mergeBunfig } from "@cosmicdrift/kumiko-testing/bunfig";
import { stripAppJobs, withAppJobsOf } from "./app-jobs.ts";
import { readManagedMarker } from "./marker.ts";
import {
  listManagedFiles,
  type ManagedAppFacts,
  type ManagedFile,
  renderBiomePresetJson,
  renderManagedBunfig,
  renderTsconfigPresetJson,
} from "./registry.ts";

export type SyncManagedOptions = {
  /** Without it nothing is written; the result lists what would happen. */
  readonly write: boolean;
  /** Also take over existing files without a marker (first adoption). */
  readonly adopt: boolean;
};

export type SyncAction =
  | { readonly action: "create" | "update" | "adopt"; readonly path: string }
  | { readonly action: "unchanged"; readonly path: string }
  | { readonly action: "skip"; readonly path: string; readonly skippedBecause: string };

type PlannedWrite = { readonly content: string; readonly executable: boolean };

// A symlinked .github or deploy/ would let the sync write outside the app.
function symlinkOnPath(appRoot: string, path: string): string | undefined {
  const segments = relative(appRoot, path).split(sep);
  let current = appRoot;
  for (const segment of segments) {
    current = join(current, segment);
    if (!existsSync(current) && !isBrokenSymlink(current)) return undefined;
    if (lstatSync(current).isSymbolicLink()) return relative(appRoot, current);
  }
  return undefined;
}

function isBrokenSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

// App jobs stay where the app put them as long as the rest matches the template.
function templateContent(rendered: string, existing: string | undefined): string {
  if (existing === undefined) return rendered;
  return stripAppJobs(existing) === stripAppJobs(rendered)
    ? existing
    : withAppJobsOf(rendered, existing);
}

function plannedContent(file: ManagedFile, existing: string | undefined): PlannedWrite | string {
  switch (file.kind) {
    case "template":
      return { content: templateContent(file.content, existing), executable: file.executable };
    case "bunfig": {
      const generated = renderManagedBunfig(file, existing);
      if (existing === undefined) return { content: generated, executable: false };
      const merged = mergeBunfig(generated, existing);
      if (!merged.ok) {
        const keys = merged.unknownKeys.map(({ section, key }) => `[${section}] ${key}`).join(", ");
        return `keys the generator does not own: ${keys}`;
      }
      return { content: merged.content, executable: false };
    }
    case "structural":
      if (existing !== undefined) return "exists; extend the preset by hand, app overrides stay";
      if (file.path === "biome.json")
        return { content: renderBiomePresetJson(), executable: false };
      if (file.path === "tsconfig.json")
        return { content: renderTsconfigPresetJson(), executable: false };
      return "write kumiko.config.ts with defineAppConfig by hand (see docs/reference/app-skeleton.md)";
    case "seed":
      return existing === undefined
        ? "app-owned seed; copy it from a fresh `kumiko new app`"
        : "app-owned";
  }
}

function planFile(
  file: ManagedFile,
  facts: ManagedAppFacts,
  options: SyncManagedOptions,
): SyncAction & { write?: PlannedWrite } {
  const path = join(facts.appRoot, file.path);
  const symlink = symlinkOnPath(facts.appRoot, path);
  if (symlink !== undefined)
    return { action: "skip", path: file.path, skippedBecause: `${symlink} is a symlink` };
  const existing = existsSync(path) ? readFileSync(path, "utf-8") : undefined;
  if (existing !== undefined && file.kind !== "structural" && file.kind !== "seed") {
    const marker = readManagedMarker(existing);
    if (marker.kind === "local")
      return { action: "skip", path: file.path, skippedBecause: `local: ${marker.reason}` };
    if (marker.kind === "invalid")
      return { action: "skip", path: file.path, skippedBecause: marker.message };
    if (marker.kind === "unmarked" && !options.adopt) {
      return {
        action: "skip",
        path: file.path,
        skippedBecause: "no kumiko-managed marker; pass --adopt to take it over",
      };
    }
  }
  const planned = plannedContent(file, existing);
  if (typeof planned === "string")
    return { action: "skip", path: file.path, skippedBecause: planned };
  const { content } = planned;
  if (existing === content) return { action: "unchanged", path: file.path };
  const action =
    existing === undefined
      ? "create"
      : readManagedMarker(existing).kind === "unmarked"
        ? "adopt"
        : "update";
  return { action, path: file.path, write: { content, executable: planned.executable } };
}

export function syncManagedFiles(
  facts: ManagedAppFacts,
  options: SyncManagedOptions,
): readonly SyncAction[] {
  return listManagedFiles(facts).map((file) => {
    const { write, ...action } = planFile(file, facts, options);
    if (options.write && write !== undefined) {
      const path = join(facts.appRoot, file.path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, write.content);
      if (write.executable) chmodSync(path, 0o755);
    }
    return action;
  });
}
