// sharp-backed renderer for the `derivativeRenderer` extension point —
// resize/fit, format+quality re-encode, whole-image blur, and pre-resize
// region blur (see BlurRegion). Server-only: sharp is a native binding.

import type {
  BlurRegion,
  DerivativeRendererPlugin,
  VariantFit,
  VariantSpec,
} from "@cosmicdrift/kumiko-types/derivatives-types";
import type { OverlayOptions, ResizeOptions, Sharp } from "sharp";
import sharp from "sharp";

const MIN_SHARP_SIGMA = 0.3;
const MAX_SHARP_SIGMA = 1000;

function normalizeMimeType(mimeType: string): string {
  return mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
}

function clampSigma(sigma: number): number {
  return Math.min(MAX_SHARP_SIGMA, Math.max(MIN_SHARP_SIGMA, sigma));
}

function assertValidRegion(region: BlurRegion): void {
  const values = [region.x, region.y, region.width, region.height];
  if (values.some((v) => !Number.isFinite(v)) || region.width <= 0 || region.height <= 0) {
    throw new Error(
      `derivatives-sharp: invalid blurRegion ${JSON.stringify(region)} — x/y/width/height must be finite and width/height must be > 0.`,
    );
  }
}

// Burns each region into the auto-oriented base image, one extract+blur+
// composite pass per region. Runs BEFORE resize: the regions are relative to
// the original pixels, and a `fit: "cover"` crop shifts pixel coordinates in
// a way a post-resize mapping can't reconstruct.
async function applyBlurRegions(
  data: Buffer,
  width: number,
  height: number,
  regions: readonly BlurRegion[],
): Promise<Buffer> {
  const overlays: OverlayOptions[] = [];

  for (const region of regions) {
    assertValidRegion(region);

    // AI-detected/user-corrected coordinates can run slightly outside the
    // frame — clamp instead of rejecting.
    const left = Math.min(Math.max(Math.round(region.x * width), 0), width);
    const top = Math.min(Math.max(Math.round(region.y * height), 0), height);
    const rectWidth = Math.min(Math.round(region.width * width), width - left);
    const rectHeight = Math.min(Math.round(region.height * height), height - top);
    if (rectWidth < 1 || rectHeight < 1) continue;

    // ponytail: fixed size-proportional sigma heuristic (no per-region sigma
    // input) — good enough until a caller needs to tune blur strength itself.
    const sigma = clampSigma(Math.max(4, Math.min(rectWidth, rectHeight) / 6));

    const patch = await sharp(data)
      .extract({ left, top, width: rectWidth, height: rectHeight })
      .blur(sigma)
      .toBuffer();
    overlays.push({ input: patch, left, top });
  }

  if (overlays.length === 0) return data;
  return sharp(data).composite(overlays).toBuffer();
}

function buildResizeOptions(width: number, height: number, fit: VariantFit): ResizeOptions {
  const options: ResizeOptions = { width, height, fit };
  if (fit === "inside") {
    // Max-box: never enlarge past the source.
    options.withoutEnlargement = true;
  }
  if (fit === "contain") {
    // sharp pads "contain" with opaque black by default — transparent instead
    // so only formats that keep alpha show a border at all (jpeg flattens it).
    options.background = { r: 0, g: 0, b: 0, alpha: 0 };
  }
  return options;
}

// HARD CONTRACT (see outputMimeType in derivatives-context.ts): with
// spec.format set, the output MUST be that format; with it unset, the
// output MUST stay the source format. The caller derives the mimeType from
// the spec alone and never inspects the bytes, so drifting from this silently
// mislabels the stored variant. sourceMimeType is a client-declared upload
// label, not sniffed from bytes, so we can't lean on sharp's "no encoder
// call" passthrough to honor it — the encoder is always called explicitly
// from the map below, and an unmapped source mimeType throws instead of
// silently keeping whatever format sharp actually decoded.
const SOURCE_FORMAT_ENCODERS: Record<string, (pipeline: Sharp, quality?: number) => Sharp> = {
  "image/jpeg": (pipeline, quality) =>
    pipeline.jpeg(quality !== undefined ? { quality } : undefined),
  // The upload whitelist admits the sloppy-but-common image/jpg alias
  "image/jpg": (pipeline, quality) =>
    pipeline.jpeg(quality !== undefined ? { quality } : undefined),
  // sharp's PngOptions.quality doesn't mean JPEG/WebP-style compression —
  // it switches PNG into palette quantization (lossless -> color-reduced,
  // banding instead of a softer/smaller image). Ignore it, same as gif.
  "image/png": (pipeline) => pipeline.png(),
  "image/webp": (pipeline, quality) =>
    pipeline.webp(quality !== undefined ? { quality } : undefined),
  "image/avif": (pipeline, quality) =>
    pipeline.avif(quality !== undefined ? { quality } : undefined),
  // sharp's GifOptions has no quality knob (palette/dither instead) — ignore
  // the value here rather than pass it through.
  "image/gif": (pipeline) => pipeline.gif(),
  "image/tiff": (pipeline, quality) =>
    pipeline.tiff(quality !== undefined ? { quality } : undefined),
};

function applyEncoder(pipeline: Sharp, spec: VariantSpec, sourceMimeType: string): Sharp {
  const quality = spec.quality;

  if (spec.format) {
    switch (spec.format) {
      case "webp":
        return pipeline.webp(quality !== undefined ? { quality } : undefined);
      case "avif":
        return pipeline.avif(quality !== undefined ? { quality } : undefined);
      case "jpeg":
        return pipeline.jpeg(quality !== undefined ? { quality } : undefined);
    }
  }

  const encode = SOURCE_FORMAT_ENCODERS[sourceMimeType];
  if (!Object.hasOwn(SOURCE_FORMAT_ENCODERS, sourceMimeType) || encode === undefined) {
    throw new Error(
      `derivatives-sharp: no output encoder for source mimeType "${sourceMimeType}" — set spec.format to pick an explicit output format.`,
    );
  }
  return encode(pipeline, quality);
}

export const renderImage: DerivativeRendererPlugin["render"] = async (
  input,
  spec,
  sourceMimeType,
) => {
  const normalizedSource = normalizeMimeType(sourceMimeType);

  // sourceMimeType is a client-declared upload label, not sniffed — decide
  // the SVG rejection from the actual bytes so a mislabeled upload can't
  // reach libvips as SVG.
  const sniffed = await sharp(input).metadata();
  if (sniffed.format === "svg") {
    throw new Error(
      "derivatives-sharp: SVG is not supported — rendering untrusted SVG through libvips is a trust boundary this renderer doesn't need to cross.",
    );
  }

  if (spec.quality !== undefined && (spec.quality < 1 || spec.quality > 100)) {
    throw new Error(`derivatives-sharp: quality ${spec.quality} is out of range (1–100).`);
  }
  if (spec.blur !== undefined && (spec.blur < MIN_SHARP_SIGMA || spec.blur > MAX_SHARP_SIGMA)) {
    throw new Error(
      `derivatives-sharp: blur sigma ${spec.blur} is out of sharp's supported range (${MIN_SHARP_SIGMA}–${MAX_SHARP_SIGMA}).`,
    );
  }

  // rotate() with no argument applies the EXIF orientation and normalizes it
  // away. sharp drops all other metadata by default — we never call
  // .withMetadata()/.keepExif(), which is exactly what strips GPS/EXIF from
  // the output.
  let pipeline = sharp(input).rotate();

  if (spec.blurRegions && spec.blurRegions.length > 0) {
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    const blurred = await applyBlurRegions(data, info.width, info.height, spec.blurRegions);
    pipeline = sharp(blurred);
  }

  const fit = spec.fit ?? "inside";
  if (spec.size) {
    pipeline = pipeline.resize(buildResizeOptions(spec.size.width, spec.size.height, fit));
  } else if (spec.maxEdge) {
    pipeline = pipeline.resize(buildResizeOptions(spec.maxEdge, spec.maxEdge, fit));
  }

  if (spec.blur !== undefined) {
    pipeline = pipeline.blur(spec.blur);
  }

  pipeline = applyEncoder(pipeline, spec, normalizedSource);

  const buffer = await pipeline.toBuffer();
  return new Uint8Array(buffer);
};

export async function imageMetadata(
  input: Uint8Array,
): Promise<{ width: number; height: number; format: string }> {
  const metadata = await sharp(input).metadata();
  const width = metadata.autoOrient.width;
  const height = metadata.autoOrient.height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || !metadata.format) {
    throw new Error("derivatives-sharp: imageMetadata got a response without width/height/format.");
  }
  return { width, height, format: metadata.format };
}
