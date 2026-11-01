import { qnMatches } from "@cosmicdrift/kumiko-framework/api";
import type { ScreenDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { compareIds } from "../labels.ts";
import type { RegistryManifestView } from "../types.ts";
import type { ApiDocsModel } from "./model.ts";
import { type ApiDocsProblem, sortApiDocsProblems } from "./problems.ts";

type UiOnlyWrite = { readonly pattern: string; readonly reason: string };

function collectStrings(value: unknown, into: Set<string>, seen: WeakSet<object>): void {
  if (typeof value === "string") {
    into.add(value);
    // skip: a string is a leaf, nothing to descend into
    return;
  }
  // skip: primitives and already visited objects add no further strings
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  const children = Array.isArray(value) ? value : isPlainObject(value) ? Object.values(value) : [];
  for (const child of children) collectStrings(child, into, seen);
}

function featureOf(qualifiedId: string): string {
  return qualifiedId.split(":")[0] ?? qualifiedId;
}

// An entityEdit screen names no handler: saving runs the entity's generated create/update.
function entityEditWrites(screen: ScreenDefinition): readonly string[] {
  if (screen.type !== "entityEdit") return [];
  const feature = featureOf(screen.id);
  const entity = screen.entity.slice(screen.entity.lastIndexOf(":") + 1);
  return [`${feature}:write:${entity}:create`, `${feature}:write:${entity}:update`];
}

/** Write QN to the ids of the screens that trigger it. */
export function writesByScreen(
  registry: RegistryManifestView,
): ReadonlyMap<string, readonly string[]> {
  const registered = new Set(registry.getAllWriteHandlers().keys());
  const screensOfWrite = new Map<string, Set<string>>();
  for (const [screenId, screen] of registry.getAllScreens()) {
    const strings = new Set<string>(entityEditWrites(screen));
    collectStrings(screen, strings, new WeakSet());
    for (const candidate of strings) {
      if (!registered.has(candidate)) continue;
      const screens = screensOfWrite.get(candidate) ?? new Set<string>();
      screens.add(screenId);
      screensOfWrite.set(candidate, screens);
    }
  }
  return new Map([...screensOfWrite].map(([qn, screens]) => [qn, [...screens].sort(compareIds)]));
}

/** UI writes that no token scope reaches, in features the docs otherwise cover. */
export function uiWriteProblems(
  registry: RegistryManifestView,
  model: ApiDocsModel,
  uiOnlyWrites: readonly UiOnlyWrite[],
): readonly ApiDocsProblem[] {
  const inScope = new Set(model.handlers.map((handler) => handler.qn));
  const coveredFeatures = new Set([...inScope].map(featureOf));
  const usedPatterns = new Set<string>();
  const problems: ApiDocsProblem[] = [];
  for (const [qn, screens] of writesByScreen(registry)) {
    if (inScope.has(qn) || !coveredFeatures.has(featureOf(qn))) continue;
    const matching = uiOnlyWrites.filter((entry) => qnMatches(entry.pattern, qn));
    for (const entry of matching) usedPatterns.add(entry.pattern);
    if (matching.length === 0) problems.push({ kind: "uiWriteOutsideScopes", qn, screens });
  }
  for (const entry of uiOnlyWrites) {
    if (!usedPatterns.has(entry.pattern)) {
      problems.push({ kind: "unusedUiOnlyWrite", pattern: entry.pattern });
    }
  }
  return sortApiDocsProblems(problems);
}
