import type { Registry } from "@cosmicdrift/kumiko-framework/engine";

export function collectExtensionOptions<TOptions extends object>(
  registry: Registry,
  extension: string,
  isOptions: (candidate: unknown) => candidate is TOptions,
): Array<{ name: string } & TOptions> {
  return registry.getExtensionUsages(extension).map((usage) => {
    if (!isOptions(usage.options)) {
      throw new Error(`${extension} registration for "${usage.entityName}" has invalid options`);
    }
    return { name: usage.entityName, ...usage.options };
  });
}

// Optional single-provider extension points: a usage with foreign options is skipped, not an error.
export function findExtensionOptions<TOptions extends object>(
  registry: Registry,
  extension: string,
  isOptions: (candidate: unknown) => candidate is TOptions,
): TOptions | undefined {
  for (const usage of registry.getExtensionUsages(extension)) {
    if (isOptions(usage.options)) return usage.options;
  }
  return undefined;
}
