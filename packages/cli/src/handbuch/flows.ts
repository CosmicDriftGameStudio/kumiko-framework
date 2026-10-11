import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { MatrixShots, Step } from "./model";

const FLOW_FILE = /^(.+?)--([a-z]{2})--(desktop|tablet|mobile)--[^.]+\.png$/;
const STEP_NUMBER_PREFIX = /^\d+[a-z]?-/;
const numericCollator = new Intl.Collator("de", { numeric: true });

export function prettifySlug(slug: string): string {
  const spaced = slug.replace(/-/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function stepSlug(stepId: string): string {
  return stepId.replace(STEP_NUMBER_PREFIX, "");
}

function isViewport(value: string): value is keyof MatrixShots {
  return value === "desktop" || value === "tablet" || value === "mobile";
}

export function discoverFlowShots(
  shotsRoot: string,
  locales: readonly string[],
): Map<string, Step[]> {
  const imagesRoot = existsSync(join(shotsRoot, "images")) ? join(shotsRoot, "images") : shotsRoot;
  const flows = new Map<string, Step[]>();
  if (!existsSync(imagesRoot)) return flows;
  const flowDirs = readdirSync(imagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const flow of flowDirs) {
    const steps = new Map<string, Step>();
    for (const file of readdirSync(join(imagesRoot, flow)).sort()) {
      const match = file.match(FLOW_FILE);
      const stepId = match?.[1];
      const locale = match?.[2];
      const viewport = match?.[3];
      if (!stepId || !locale || !viewport || !isViewport(viewport)) continue;
      if (!locales.includes(locale)) continue;
      const step = steps.get(stepId) ?? {
        id: stepId,
        slug: stepSlug(stepId),
        label: prettifySlug(stepSlug(stepId)),
        shots: new Map<string, MatrixShots>(),
      };
      const shots = step.shots.get(locale) ?? {};
      shots[viewport] = join(imagesRoot, flow, file);
      step.shots.set(locale, shots);
      steps.set(stepId, step);
    }
    if (steps.size > 0) {
      flows.set(
        flow,
        [...steps.values()].sort((a, b) => numericCollator.compare(a.id, b.id)),
      );
    }
  }
  return flows;
}

function headingSlug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .replace(STEP_NUMBER_PREFIX, "");
}

export function splitStepSections(
  bodyMd: string,
  stepSlugs: ReadonlySet<string>,
): { intro: string; sections: Map<string, string> } {
  const introLines: string[] = [];
  const sections = new Map<string, string[]>();
  let current: string[] = introLines;
  for (const line of bodyMd.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading?.[1]) {
      const slug = headingSlug(heading[1]);
      if (stepSlugs.has(slug)) {
        current = [];
        sections.set(slug, current);
        continue;
      }
      current = introLines;
    }
    current.push(line);
  }
  return {
    intro: introLines.join("\n"),
    sections: new Map([...sections].map(([slug, lines]) => [slug, lines.join("\n")])),
  };
}
