import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { demo, type DemoDef } from "../../demos/demo";
import { step, type Step } from "../../demos/step";
import { resolveFixture } from "./fixtures";
import { interpolate } from "./interpolate";
import { resolveCliStep } from "./presets";
import type { DemoManifest, StepRaw, VerifyMode } from "./types";

export type HydrateOptions = {
  readonly demoId: string;
  readonly kitRoot?: string;
};

function verifyFlags(verify: VerifyMode | undefined): {
  recordingOnly?: boolean;
  e2eSkip?: boolean;
} {
  if (verify === "record-only") return { recordingOnly: true };
  if (verify === "skip") return { e2eSkip: true };
  return {};
}

function hydrateBrowserFields(
  raw: StepRaw,
  vars: Readonly<Record<string, string | number | boolean>>,
): Pick<Step, "navigate" | "click" | "waitFor" | "fill"> {
  const out: {
    navigate?: string;
    click?: string;
    waitFor?: string;
    fill?: Readonly<Record<string, string>>;
  } = {};
  if (raw.navigate) out.navigate = interpolate(raw.navigate, vars);
  if (raw.click) out.click = interpolate(raw.click, vars);
  if (raw.waitFor) out.waitFor = interpolate(raw.waitFor, vars);
  if (raw.fill) {
    const filled: Record<string, string> = {};
    for (const [sel, val] of Object.entries(raw.fill)) {
      filled[sel] = interpolate(val, vars);
    }
    out.fill = filled;
  }
  return out;
}

export function hydrateStep(
  raw: StepRaw,
  demoDir: string,
  vars: Readonly<Record<string, string | number | boolean>>,
): Step {
  const flags = verifyFlags(raw.verify);
  const caption = raw.caption;

  if (raw.kind === "cli") {
    const { command, waitMs, waitForPort } = resolveCliStep(raw, vars);
    return step.cli({
      type: command,
      waitMs,
      waitForPort,
      caption,
      ...flags,
    });
  }

  if (raw.kind === "editor") {
    if (!raw.file || !raw.content) {
      throw new Error(`hydrateStep: editor step "${raw.id}" needs file + content`);
    }
    const write = resolveFixture(demoDir, raw.content);
    return step.editor({
      file: raw.file,
      write,
      caption,
      ...flags,
    });
  }

  if (raw.kind === "browser") {
    const fields = hydrateBrowserFields(raw, vars);
    return step.browser({ ...fields, caption, ...flags });
  }

  throw new Error(`hydrateStep: unknown kind on step "${raw.id}"`);
}

export function loadDemoManifest(demoDir: string): DemoManifest {
  const path = join(demoDir, "demo.yaml");
  const manifest = parseYaml(readFileSync(path, "utf8")) as DemoManifest;
  if (!manifest.title || !manifest.steps?.length) {
    throw new Error(`loadDemoManifest: invalid demo.yaml at ${demoDir}`);
  }
  return manifest;
}

export function loadStepRaw(stepPath: string): StepRaw {
  const raw = parseYaml(readFileSync(stepPath, "utf8")) as StepRaw;
  if (!raw.id || !raw.kind || !raw.caption) {
    throw new Error(`loadStepRaw: invalid step file ${stepPath}`);
  }
  return raw;
}

export function hydrateDemo(opts: HydrateOptions): DemoDef {
  const kitRoot = opts.kitRoot ?? join(dirname(fileURLToPath(import.meta.url)), "..");
  const demoDir = join(kitRoot, "demos", opts.demoId);
  const manifest = loadDemoManifest(demoDir);

  const vars: Record<string, string | number | boolean> = {
    port: 3000,
    ...manifest.vars,
  };

  const steps: Step[] = [];
  for (const rel of manifest.steps) {
    const stepPath = join(demoDir, rel);
    const raw = loadStepRaw(stepPath);
    steps.push(hydrateStep(raw, demoDir, vars));
  }

  return demo({ title: manifest.title, steps });
}


