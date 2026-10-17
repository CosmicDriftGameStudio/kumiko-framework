import {
  assertNotSvg,
  isResourceImageFormat,
  RESOURCE_IMAGE_FORMATS,
  type ResourceImageContentType,
  SHARP_INPUT_OPTIONS,
} from "../shared/index.js";

const MAX_RESOURCE_WIDTH = 1200;

export type NormalizedResourceImage = {
  readonly data: Uint8Array;
  readonly contentType: ResourceImageContentType;
  readonly width: number;
  readonly height: number;
};

// Re-encodes an uploaded image: the stored content type comes from the decoded format, never
// from the client, and re-encoding drops metadata and anything appended to the file.
// sharp is imported lazily because every app loads template-resolver, few of them need an image decoder.
export async function normalizeResourceImage(data: Uint8Array): Promise<NormalizedResourceImage> {
  const { default: sharp } = await import("sharp");
  const metadata = await sharp(data, SHARP_INPUT_OPTIONS).metadata();
  assertNotSvg(metadata.format);
  if (!isResourceImageFormat(metadata.format)) {
    throw new Error(`unsupported image format "${metadata.format ?? "unknown"}"`);
  }
  const format = metadata.format;
  const pipeline = sharp(data, SHARP_INPUT_OPTIONS)
    .rotate()
    .resize({ width: MAX_RESOURCE_WIDTH, withoutEnlargement: true })
    .toFormat(format);
  const { data: output, info } = await pipeline.toBuffer({ resolveWithObject: true });
  return {
    data: new Uint8Array(output),
    contentType: RESOURCE_IMAGE_FORMATS[format].contentType,
    width: info.width,
    height: info.height,
  };
}
