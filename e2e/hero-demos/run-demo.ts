// Generic playwright runner that executes a DemoDef step-by-step.
// Same DemoDef object the recorder consumes — single source of truth.
//
// step.cli   → execFileSync inside the scaffold dir (skipped if the step
//              is the "launch the dev server" line; the webServer already
//              boots it). Recognised by `bun dev` substring; everything
//              else (e.g. cd, git, custom CLI calls) runs verbatim.
// step.editor → writeFileSync into the scaffold dir.
// step.browser → page.goto / page.click / page.waitForSelector.
//
// Caption text is asserted to be non-empty so a misconfigured step
// (missing translation) fails the test, not just the recorder.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import type { DemoDef } from "../../scripts/demos/demo";

const HERE = dirname(fileURLToPath(import.meta.url));

function rewritePort(url: string): string {
  const port = process.env["HERO_PORT"] ?? process.env["PORT"];
  if (!port) return url;
  return url.replace(/:3000(\b|\/)/g, `:${port}$1`);
}

export type RunDemoOptions = {
  /** Subdir under e2e/hero-demos/.tmp matching the boot-demo invocation. */
  readonly scaffoldName: string;
};

export async function runDemo(
  page: Page,
  demoDef: DemoDef,
  opts: RunDemoOptions,
): Promise<void> {
  const appDir = resolve(HERE, ".tmp", opts.scaffoldName);

  for (const step of demoDef.steps) {
    if (step.caption) {
      expect(step.caption.de.length, "caption.de must be non-empty").toBeGreaterThan(0);
      expect(step.caption.en.length, "caption.en must be non-empty").toBeGreaterThan(0);
    }
    if (step.recordingOnly) {
      console.log(`[run-demo] skip recordingOnly step (${step.kind})`);
      continue;
    }
    if (step.e2eSkip) {
      console.log(`[run-demo] skip e2eSkip step (${step.kind})`);
      continue;
    }

    if (step.kind === "cli") {
      const cmd = step.type;
      console.log(`[run-demo] cli: ${cmd}`);
      execFileSync("bash", ["-c", cmd], { cwd: appDir, stdio: "inherit" });
    } else if (step.kind === "editor") {
      const target = resolve(appDir, step.file);
      console.log(`[run-demo] editor: writing ${step.file}`);
      writeFileSync(target, step.write);
    } else {
      if (step.navigate) {
        // DemoDef hardcodes :3000 (the recorder default) — rewrite to
        // whatever port the E2E webServer chose (HERO_PORT).
        const url = rewritePort(step.navigate);
        console.log(`[run-demo] browser: goto ${url}`);
        await page.goto(url);
      }
      if (step.fill) {
        for (const [sel, val] of Object.entries(step.fill)) {
          console.log(`[run-demo] browser: fill ${sel}`);
          await page.fill(sel, val);
        }
      }
      if (step.click) {
        console.log(`[run-demo] browser: click ${step.click}`);
        await page.click(step.click);
      }
      if (step.waitFor) {
        console.log(`[run-demo] browser: waitFor ${step.waitFor}`);
        await page.waitForSelector(step.waitFor);
      }
    }
  }
}


