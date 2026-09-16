#!/usr/bin/env bun
// UI-guard bundle (App-Mounting 2.0, infra#208): one process, shared ts-morph
// Project over the UI enforcement guards.
import {
  buildSharedProject,
  printGuardKitBanner,
  reportResults,
  runGuards,
} from "./_lib/guard-kit";
import { guard as i18nUiStrings } from "./guard-i18n-ui-strings";
import { guard as noCustomPrimitives } from "./guard-no-custom-primitives";
import { guard as noInlineStyles } from "./guard-no-inline-styles";
import { guard as noRawHooks } from "./guard-no-raw-hooks";
import { guard as rawClassname } from "./guard-raw-classname";
import { guard as rawInteractiveElements } from "./guard-raw-interactive-elements";
import { guard as tailwindScanSurface } from "./guard-tailwind-scan-surface";

export const UI_GUARDS = [
  rawClassname,
  noInlineStyles,
  noCustomPrimitives,
  noRawHooks,
  tailwindScanSurface,
  rawInteractiveElements,
  i18nUiStrings,
];

// Same as run-guards.ts: only run on direct invocation.
if (import.meta.main) {
  const project = buildSharedProject(UI_GUARDS);
  printGuardKitBanner(UI_GUARDS.length, project);
  const failed = reportResults(runGuards(UI_GUARDS, project));
  process.exit(failed > 0 ? 1 : 0);
}
