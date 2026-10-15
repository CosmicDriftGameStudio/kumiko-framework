import { assertNotSvg, SHARP_INPUT_OPTIONS } from "../shared/index.js";

const MAX_RESOURCE_WIDTH = 1200;

const CONTENT_TYPE_BY_FORMAT = {
  png: "image/png",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
} as const;

type ResourceImageFormat = keyof typeof CONTENT_TYPE_BY_FORMAT;

export type NormalizedResourceImage = {
  readonly data: Uint8Array;
  readonly contentType: (typeof CONTENT_TYPE_BY_FORMAT)[ResourceImageFormat];
  readonly width: number;
  readonly height: number;
};

function isResourceImageFormat(format: string | undefined): format is ResourceImageFormat {
  return format !== undefined && Object.hasOwn(CONTENT_TYPE_BY_FORMAT, format);
}

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
    contentType: CONTENT_TYPE_BY_FORMAT[format],
    width: info.width,
    height: info.height,
  };
}
