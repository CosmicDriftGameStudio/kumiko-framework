export type GroupableOption = { readonly group?: string };

export type OptionGroup<T extends GroupableOption> = {
  readonly heading: string | undefined;
  readonly options: readonly T[];
};

function isGrouped(option: GroupableOption): option is { readonly group: string } {
  return option.group !== undefined && option.group !== "";
}

// Ungrouped options come first (original order), then one section per `group`
// in order of its first occurrence. An empty-string group counts as ungrouped.
export function groupOptions<T extends GroupableOption>(
  options: readonly T[],
): readonly OptionGroup<T>[] {
  const ungrouped: T[] = [];
  const byHeading = new Map<string, T[]>();
  for (const option of options) {
    if (!isGrouped(option)) {
      ungrouped.push(option);
      continue;
    }
    const bucket = byHeading.get(option.group);
    if (bucket === undefined) byHeading.set(option.group, [option]);
    else bucket.push(option);
  }
  return [
    ...(ungrouped.length > 0 ? [{ heading: undefined, options: ungrouped }] : []),
    ...[...byHeading].map(([heading, grouped]) => ({ heading, options: grouped })),
  ];
}

export function hasDescriptionOrGroup(
  options: readonly (GroupableOption & { readonly description?: string })[],
): boolean {
  return options.some((option) => option.description !== undefined || isGrouped(option));
}
