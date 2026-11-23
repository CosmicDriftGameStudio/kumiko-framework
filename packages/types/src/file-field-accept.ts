import type { AnyFileFieldDef } from "./fields.ts";

// No svg: scriptable. No bmp/tiff: no consumer needs them. heic/heif/avif stay because the web
// picker passes HEIC through unchanged when the browser cannot decode it.
export const DEFAULT_IMAGE_FIELD_ACCEPT = [
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "avif",
  "heic",
  "heif",
] as const;

// An explicit `accept: []` stays the opt-out for "everything allowed", because validateFile only
// checks accept when it is non-empty and the picker then sets no accept attribute.
export function effectiveFileFieldAccept(
  fieldDef: Pick<AnyFileFieldDef, "type" | "accept">,
): readonly string[] | undefined {
  return (
    fieldDef.accept ??
    (fieldDef.type === "image" || fieldDef.type === "images"
      ? DEFAULT_IMAGE_FIELD_ACCEPT
      : undefined)
  );
}
