import { readdirSync } from "node:fs";
import { join } from "node:path";
import { hydrateDemo, loadDemoManifest, loadStepRaw } from "./hydrate";
import { isFixtureRef, resolveFixture } from "./fixtures";
import type { StepRaw } from "./types";

function isPlausibleSelector(s: string): boolean {
  return /^\[data-[a-z-]+=|^#|^\.|^[a-z][a-z0-9]*[ >+~[]?/.test(s);
}

function isInsideAppTree(path: string): boolean {
  if (path.startsWith("/") || path.includes("..")) return false;
  return (
    path.startsWith("src/") ||
    path.startsWith("bin/") ||
    path === ".env" ||
    /^(package|tsconfig|biome|bunfig|docker-compose)\b/.test(path)
  );
}

export function validateDemoSchema(demoId: string, kitRoot: string): readonly string[] {
  const errors: string[] = [];
  const demoDir = join(kitRoot, "demos", demoId);

  let manifest;
  try {
    manifest = loadDemoManifest(demoDir);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
    return errors;
  }

  if (!/^[a-z][a-z0-9-]*$/.test(manifest.title)) {
    errors.push(`demo "${demoId}": title must be kebab-case`);
  }

  for (const rel of manifest.steps) {
    const stepPath = join(demoDir, rel);
    let raw: StepRaw;
    try {
      raw = loadStepRaw(stepPath);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      continue;
    }

    if (raw.caption.de.length === 0 || raw.caption.en.length === 0) {
      errors.push(`${raw.id}: empty caption`);
    }
    if (raw.caption.de.length > 60 || raw.caption.en.length > 60) {
      errors.push(`${raw.id}: caption > 60 chars`);
    }

    if (raw.kind === "browser") {
      for (const sel of [raw.click, raw.waitFor]) {
        if (sel && !isPlausibleSelector(sel)) {
          errors.push(`${raw.id}: implausible selector "${sel}"`);
        }
      }
      if (raw.navigate && !/^https?:\/\//.test(raw.navigate)) {
        errors.push(`${raw.id}: navigate must be http(s) URL`);
      }
    }

    if (raw.kind === "editor") {
      if (!raw.file || !isInsideAppTree(raw.file)) {
        errors.push(`${raw.id}: editor file "${raw.file ?? ""}" outside app tree`);
      }
      if (!raw.content) {
        errors.push(`${raw.id}: editor missing content`);
      } else if (isFixtureRef(raw.content)) {
        try {
          resolveFixture(demoDir, raw.content);
        } catch (e) {
          errors.push(`${raw.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    if (raw.kind === "cli" && !raw.preset && !raw.command) {
      errors.push(`${raw.id}: cli needs preset or command`);
    }
  }

  // Hydration must not throw
  try {
    hydrateDemo({ demoId, kitRoot });
  } catch (e) {
    errors.push(`hydrate: ${e instanceof Error ? e.message : String(e)}`);
  }

  return errors;
}

export function listDemoIds(kitRoot: string): readonly string[] {
  const demosDir = join(kitRoot, "demos");
  return readdirSync(demosDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}
