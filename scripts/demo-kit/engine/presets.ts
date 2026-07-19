import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { interpolate } from "./interpolate";
import type { CliPreset, CliPresetFile, StepRaw } from "./types";

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRESETS_PATH = join(KIT_ROOT, "presets", "cli.yaml");

let cachedPresets: Readonly<Record<string, CliPreset>> | undefined;

export function loadCliPresets(): Readonly<Record<string, CliPreset>> {
  if (cachedPresets) return cachedPresets;
  const raw = parseYaml(readFileSync(PRESETS_PATH, "utf8")) as CliPresetFile;
  cachedPresets = raw.presets;
  return cachedPresets;
}

export function expandCliPreset(
  presetName: string,
  vars: Readonly<Record<string, string | number | boolean>>,
  stepArgs?: Readonly<Record<string, string | number | boolean>>,
): { command: string; waitMs?: number; waitForPort?: number } {
  const presets = loadCliPresets();
  const preset = presets[presetName];
  if (!preset) {
    throw new Error(`expandCliPreset: unknown preset "${presetName}"`);
  }

  const merged: Record<string, string | number | boolean> = { ...vars, ...stepArgs };
  if (preset.yesSuffix !== undefined && stepArgs?.yes === true) {
    merged.yesSuffix = preset.yesSuffix;
  } else if (preset.yesSuffix !== undefined) {
    merged.yesSuffix = "";
  }

  const command = interpolate(preset.template, merged);

  let waitMs = preset.waitMs;
  let waitForPort: number | undefined;
  if (preset.wait === "port" && preset.waitForPort !== undefined) {
    const portStr = interpolate(String(preset.waitForPort), merged);
    waitForPort = Number(portStr);
    if (Number.isNaN(waitForPort)) {
      throw new Error(`expandCliPreset: invalid waitForPort "${portStr}" for preset "${presetName}"`);
    }
  }

  return { command, waitMs, waitForPort };
}

export function resolveCliStep(
  raw: StepRaw,
  vars: Readonly<Record<string, string | number | boolean>>,
): { command: string; waitMs?: number; waitForPort?: number } {
  if (raw.command) {
    return {
      command: interpolate(raw.command, vars),
      waitMs: raw.waitMs,
      waitForPort: raw.waitForPort,
    };
  }
  if (!raw.preset) {
    throw new Error(`resolveCliStep: step "${raw.id}" needs preset or command`);
  }
  const expanded = expandCliPreset(raw.preset, vars, raw.args);
  return {
    command: expanded.command,
    waitMs: raw.waitMs ?? expanded.waitMs,
    waitForPort: raw.waitForPort ?? expanded.waitForPort,
  };
}

/** Test helper — reset preset cache between tests. */
export function resetCliPresetsCache(): void {
  cachedPresets = undefined;
}
