import type { Registry } from "../engine/types/index.ts";
import { deriveSearchAdapterConfig } from "./derive-search-adapter-config.ts";

export function collectSearchableFieldNames(registry: Registry): readonly string[] {
  return deriveSearchAdapterConfig(registry)?.searchableFields ?? [];
}
