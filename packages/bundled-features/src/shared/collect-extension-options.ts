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
