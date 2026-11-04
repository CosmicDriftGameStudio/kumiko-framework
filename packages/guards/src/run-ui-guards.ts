#!/usr/bin/env bun
// UI-guard bundle (App-Mounting 2.0): one process, shared ts-morph
// Project over the UI enforcement guards.
import {
  buildSharedProject,
  cliFlagsError,
  printGuardKitBanner,
  reportResults,
  runGuards,
} from "./_lib/guard-kit";
import { guard as i18nUiStrings } from "./guard-i18n-ui-strings";
import { guard as noFramedExtensionSections } from "./guard-no-framed-extension-sections";
import { guard as tailwindScanSurface } from "./guard-tailwind-scan-surface";

export const UI_GUARDS = [noFramedExtensionSections, tailwindScanSurface, i18nUiStrings];

// No flags today — the array stays so an unknown flag still fails loud
// instead of silently doing nothing, and so a future flag has one place to land.
export const UI_GUARD_FLAGS: readonly string[] = [];

// Shared by the direct `bun run-ui-guards.ts` invocation below and by the
// `ui` subcommand in cli.ts.
export function runUiGuardsCli(argv: readonly string[]): number {
  const flagsError = cliFlagsError("ui", argv, UI_GUARD_FLAGS);
  if (flagsError !== undefined) {
    console.error(flagsError);
    return 1;
  }
  const project = buildSharedProject(UI_GUARDS);
  printGuardKitBanner(UI_GUARDS.length, project);
  return reportResults(runGuards(UI_GUARDS, project));
}

// Same as run-guards.ts: only run on direct invocation.
if (import.meta.main) {
  process.exit(runUiGuardsCli(process.argv.slice(2)) > 0 ? 1 : 0);
}
