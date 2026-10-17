// Single source for the raster formats a template resource image may have: the normalizer, the
// stored file extension, the data-URI embedding and the inline mail attachment name all derive
// from it, so a new format cannot be accepted in one place and dropped in another.
export const RESOURCE_IMAGE_FORMATS = {
  png: { contentType: "image/png", extension: "png" },
  jpeg: { contentType: "image/jpeg", extension: "jpg" },
  gif: { contentType: "image/gif", extension: "gif" },
  webp: { contentType: "image/webp", extension: "webp" },
} as const;

export type ResourceImageFormat = keyof typeof RESOURCE_IMAGE_FORMATS;
export type ResourceImageContentType =
  (typeof RESOURCE_IMAGE_FORMATS)[ResourceImageFormat]["contentType"];

export function isResourceImageFormat(format: string | undefined): format is ResourceImageFormat {
  return format !== undefined && Object.hasOwn(RESOURCE_IMAGE_FORMATS, format);
}

function formatForContentType(contentType: string) {
  return Object.values(RESOURCE_IMAGE_FORMATS).find((entry) => entry.contentType === contentType);
}

export function isResourceImageContentType(
  contentType: string,
): contentType is ResourceImageContentType {
  return formatForContentType(contentType) !== undefined;
}

export function extensionForResourceContentType(contentType: string): string | undefined {
  return formatForContentType(contentType)?.extension;
}
