// Interactive feature picker. Renders the vendored manifest as a grouped
// multi-select (by uiHints.category), default-checks features marked
// recommended:true, and only offers features that have a constructor entry
// in FEATURE_CONSTRUCTORS (the rest aren't mountable yet, hidden until
// fast-follow lands their constructor).
//
// Output is the user-confirmed selection; the caller (cli.ts) feeds it
// through resolveDeps + maps each name to its ScaffoldFeatureEntry.

import { checkbox, Separator } from "@inquirer/prompts";
import { FEATURE_CONSTRUCTORS } from "./feature-constructors";
import type { Manifest, ManifestFeatureEntry } from "./manifest";

export type PickerChoice = {
  readonly name: string;
  readonly displayLabel: string;
  readonly category: string;
  readonly recommended: boolean;
  readonly description: string | null;
};

export function buildChoices(manifest: Manifest): readonly PickerChoice[] {
  return manifest.features
    .filter((f) => Object.hasOwn(FEATURE_CONSTRUCTORS, f.name))
    .map((f) => toChoice(f));
}

function toChoice(f: ManifestFeatureEntry): PickerChoice {
  return {
    name: f.name,
    displayLabel: f.uiHints?.displayLabel ?? f.name,
    category: f.uiHints?.category ?? "other",
    recommended: f.uiHints?.recommended ?? false,
    description: f.description,
  };
}

export async function runPicker(manifest: Manifest): Promise<readonly string[]> {
  const choices = buildChoices(manifest);
  const grouped = groupByCategory(choices);
  const items: Array<
    { name: string; value: string; checked: boolean } | InstanceType<typeof Separator>
  > = [];
  for (const [category, group] of grouped) {
    items.push(new Separator(`── ${category} ──`));
    for (const c of group) {
      items.push({
        name: `${c.displayLabel}${c.recommended ? " (recommended)" : ""}`,
        value: c.name,
        checked: c.recommended,
      });
    }
  }
  const selected = await checkbox({
    message: "Welche Features?",
    choices: items,
    pageSize: 20,
    loop: false,
  });
  return selected;
}

function groupByCategory(
  choices: readonly PickerChoice[],
): ReadonlyArray<readonly [string, readonly PickerChoice[]]> {
  const buckets = new Map<string, PickerChoice[]>();
  for (const c of choices) {
    const list = buckets.get(c.category) ?? [];
    list.push(c);
    buckets.set(c.category, list);
  }
  return [...buckets.entries()].map(([cat, list]) => [
    cat,
    [...list].sort((a, b) => a.displayLabel.localeCompare(b.displayLabel)),
  ]);
}
