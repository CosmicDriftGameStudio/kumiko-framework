import type { FieldDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { ListColumnFileDisplay, ListColumnViewModel } from "./types.js";

function firstVariantKey(fieldDef: FieldDefinition): string | undefined {
  const variants = (fieldDef as { variants?: Readonly<Record<string, unknown>> }).variants;
  return variants === undefined ? undefined : Object.keys(variants)[0];
}

function fromFormatSpec(
  renderer: ListColumnViewModel["renderer"],
): ListColumnFileDisplay | undefined {
  if (typeof renderer !== "object" || renderer === null || !("format" in renderer)) {
    return undefined;
  }
  if (renderer.format === "file") return { kind: "file" };
  if (renderer.format !== "image") return undefined;
  return renderer.variant === undefined
    ? { kind: "image" }
    : { kind: "image", variant: renderer.variant };
}

function fromFieldType(fieldDef: FieldDefinition): ListColumnFileDisplay | undefined {
  if (fieldDef.type === "file" || fieldDef.type === "files") return { kind: "file" };
  if (fieldDef.type !== "image" && fieldDef.type !== "images") return undefined;
  const variant = firstVariantKey(fieldDef);
  return variant === undefined ? { kind: "image" } : { kind: "image", variant };
}

// An explicit `{ format: "image" | "file" }` renderer wins over the field type.
export function deriveListFileDisplay(
  fieldDef: FieldDefinition,
  renderer: ListColumnViewModel["renderer"],
): ListColumnFileDisplay | undefined {
  return fromFormatSpec(renderer) ?? fromFieldType(fieldDef);
}
