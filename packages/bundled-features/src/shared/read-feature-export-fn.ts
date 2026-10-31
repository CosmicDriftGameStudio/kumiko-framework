import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";

export function readFeatureExportFn<TFn extends (...args: never[]) => unknown>(
  feature: FeatureDefinition,
  exportName: string,
): TFn | undefined {
  const exports = feature.exports;
  if (exports && typeof exports === "object" && exportName in exports) {
    const candidate = Reflect.get(exports, exportName);
    if (typeof candidate === "function") {
      // @cast-boundary feature-exports — feature.exports is untyped by design
      return candidate as TFn;
    }
  }
  return undefined;
}
