// Real sharp roundtrips — no mocked pipeline. Fixtures are built with
// `sharp({ create: {...} })` so every case decodes real bytes end-to-end.

import { describe, expect, test } from "bun:test";
import type { VariantSpec } from "@cosmicdrift/kumiko-types/derivatives-types";
import sharp from "sharp";
import { imageMetadata, renderImage } from "../render";

async function jpegFixture(
  width: number,
  height: number,
  color = { r: 200, g: 40, b: 40 },
): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } })
    .jpeg()
    .toBuffer();
}

async function orientedJpegFixture(width: number, height: number, orientation: number) {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } })
    .jpeg()
    .withMetadata({ orientation })
    .toBuffer();
}

async function pngFixture(
  width: number,
  height: number,
  color = { r: 40, g: 120, b: 200 },
): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } })
    .png()
    .toBuffer();
}

// Minimal well-formed SVG, valid input for sharp/librsvg — used to prove the
// renderer rejects it by sniffing bytes, not by trusting a declared mimeType.
const SVG_BYTES = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>',
);

// Real bytes just need to decode — the test is about the declared
// "image/bmp" mimeType having no entry in the source-format encoder map, not
// about the actual pixel format.
async function unmappedFormatFixture(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 100, g: 100, b: 100 } },
  })
    .tiff()
    .toBuffer();
}

// Two flat-colour halves straddled by the blur test's region, so blurring
// mixes visibly detectable pixels at the boundary without needing synthetic
// noise texture inside an otherwise-flat fixture.
async function twoColorPngFixture(width: number, height: number): Promise<Buffer> {
  const left = { r: 220, g: 20, b: 20 };
  const right = { r: 20, g: 20, b: 220 };
  const rightHalf = await sharp({
    create: { width: width / 2, height, channels: 3, background: right },
  })
    .png()
    .toBuffer();
  return sharp({ create: { width, height, channels: 3, background: left } })
    .composite([{ input: rightHalf, left: width / 2, top: 0 }])
    .png()
    .toBuffer();
}

// composite() promotes the output to include an alpha channel even when
// every input was opaque RGB — read the channel count back instead of
// assuming it, or the byte offsets below silently point at the wrong pixel.
async function rawPixel(buffer: Uint8Array, x: number, y: number) {
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  return Array.from(data.subarray(offset, offset + info.channels));
}

describe("renderImage — resize/fit", () => {
  test("maxEdge + cover produces an exact square (the thumb preset)", async () => {
    const input = await jpegFixture(400, 200);
    const output = await renderImage(input, { maxEdge: 160, fit: "cover" }, "image/jpeg");
    const meta = await sharp(output).metadata();
    expect(meta.width).toBe(160);
    expect(meta.height).toBe(160);
  });

  test("size + inside preserves aspect ratio inside the box", async () => {
    const input = await jpegFixture(400, 200);
    const output = await renderImage(
      input,
      { size: { width: 200, height: 200 }, fit: "inside" },
      "image/jpeg",
    );
    const meta = await sharp(output).metadata();
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(100);
  });

  test("contain pads to fill the exact box", async () => {
    const input = await jpegFixture(400, 200);
    const output = await renderImage(
      input,
      { size: { width: 100, height: 100 }, fit: "contain" },
      "image/jpeg",
    );
    const meta = await sharp(output).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(100);
  });

  test("inside with a maxEdge larger than the source never enlarges", async () => {
    const input = await jpegFixture(400, 200);
    const output = await renderImage(input, { maxEdge: 4000, fit: "inside" }, "image/jpeg");
    const meta = await sharp(output).metadata();
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(200);
  });
});

describe("renderImage — format contract", () => {
  test("without spec.format the source format is preserved", async () => {
    const input = await jpegFixture(400, 200);
    const output = await renderImage(input, { maxEdge: 100 }, "image/jpeg");
    const meta = await sharp(output).metadata();
    expect(meta.format).toBe("jpeg");
  });

  test("with spec.format the output switches format", async () => {
    const input = await jpegFixture(400, 200);
    const output = await renderImage(input, { maxEdge: 100, format: "webp" }, "image/jpeg");
    const meta = await sharp(output).metadata();
    expect(meta.format).toBe("webp");
  });

  test("the image/jpg upload alias is accepted without spec.format", async () => {
    const input = await jpegFixture(400, 200);
    const output = await renderImage(input, { maxEdge: 100 }, "image/jpg");
    const meta = await sharp(output).metadata();
    expect(meta.format).toBe("jpeg");
  });
});

describe("renderImage — EXIF", () => {
  test("all EXIF is stripped from the output", async () => {
    const input = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 10, g: 10, b: 10 } },
    })
      .jpeg()
      .withExif({ IFD0: { Copyright: "kumiko-test" } })
      .toBuffer();

    const output = await renderImage(input, { maxEdge: 100 }, "image/jpeg");
    const meta = await sharp(output).metadata();
    expect(meta.exif).toBeUndefined();
  });

  test("EXIF orientation is applied (dimensions swap) then normalized away", async () => {
    const input = await orientedJpegFixture(400, 200, 6);
    const output = await renderImage(input, {}, "image/jpeg");
    const meta = await sharp(output).metadata();
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(400);
  });
});

describe("renderImage — blurRegions", () => {
  test("burns blur into the region, leaves the rest byte-identical", async () => {
    const input = await twoColorPngFixture(200, 200);
    const baseline = await renderImage(input, {}, "image/png");
    const spec: VariantSpec = {
      blurRegions: [{ x: 0.35, y: 0.25, width: 0.3, height: 0.5 }],
    };
    const blurred = await renderImage(input, spec, "image/png");

    // Region centre sits on the red/blue boundary (x≈0.5) — blur mixes the
    // two colours there, so it must differ from the untouched baseline.
    const centreBaseline = await rawPixel(baseline, 100, 100);
    const centreBlurred = await rawPixel(blurred, 100, 100);
    expect(centreBlurred).not.toEqual(centreBaseline);

    // Far outside the region: composite never touched these pixels.
    const farBaseline = await rawPixel(baseline, 10, 10);
    const farBlurred = await rawPixel(blurred, 10, 10);
    expect(farBlurred).toEqual(farBaseline);
  });
});

describe("renderImage — validation", () => {
  test("blur sigma below sharp's supported range throws", async () => {
    const input = await jpegFixture(50, 50);
    await expect(renderImage(input, { blur: 0.1 }, "image/jpeg")).rejects.toThrow(/blur sigma/);
  });

  test("quality out of range throws", async () => {
    const input = await jpegFixture(50, 50);
    await expect(renderImage(input, { quality: 0 }, "image/jpeg")).rejects.toThrow(/quality/);
  });

  test("real SVG bytes are rejected even with a spoofed sourceMimeType", async () => {
    await expect(renderImage(SVG_BYTES, {}, "image/jpeg")).rejects.toThrow(/svg/i);
  });

  test("real PNG bytes with a spoofed sourceMimeType encode as the declared type", async () => {
    const input = await pngFixture(50, 50);
    const output = await renderImage(input, {}, "image/jpeg");
    const meta = await sharp(output).metadata();
    expect(meta.format).toBe("jpeg");
  });

  test("a source mimeType with no encoder mapping throws unless spec.format is set", async () => {
    const input = await unmappedFormatFixture(50, 50);
    await expect(renderImage(input, {}, "image/bmp")).rejects.toThrow(/no output encoder/);

    const output = await renderImage(input, { format: "webp" }, "image/bmp");
    const meta = await sharp(output).metadata();
    expect(meta.format).toBe("webp");
  });

  test("a sourceMimeType matching an inherited Object.prototype key throws instead of using it as an encoder", async () => {
    // Plain-object lookup on SOURCE_FORMAT_ENCODERS would resolve
    // "constructor" to Object (an inherited key, not a real entry) without
    // an Object.hasOwn guard — proving the throw path, not a silent pass-through.
    const input = await unmappedFormatFixture(50, 50);
    await expect(renderImage(input, {}, "constructor")).rejects.toThrow(/no output encoder/);
  });

  test("blurRegions beyond the cap throws instead of re-decoding the image once per region", async () => {
    const input = await jpegFixture(50, 50);
    const tooManyRegions = Array.from({ length: 65 }, () => ({
      x: 0.1,
      y: 0.1,
      width: 0.1,
      height: 0.1,
    }));
    await expect(renderImage(input, { blurRegions: tooManyRegions }, "image/jpeg")).rejects.toThrow(
      /blurRegions/,
    );
  });

  test("64 blurRegions (at the cap) is accepted", async () => {
    const input = await jpegFixture(200, 200);
    const regions = Array.from({ length: 64 }, (_, i) => ({
      x: 0.01 * i,
      y: 0.01 * i,
      width: 0.01,
      height: 0.01,
    }));
    await expect(renderImage(input, { blurRegions: regions }, "image/jpeg")).resolves.toBeTruthy();
  });

  test("size.width/size.height beyond MAX_OUTPUT_EDGE throws instead of allocating an oversized buffer", async () => {
    const input = await jpegFixture(50, 50);
    await expect(
      renderImage(input, { size: { width: 50000, height: 50000 } }, "image/jpeg"),
    ).rejects.toThrow(/size\.width/);
  });

  test("maxEdge beyond MAX_OUTPUT_EDGE throws", async () => {
    const input = await jpegFixture(50, 50);
    await expect(renderImage(input, { maxEdge: 50000 }, "image/jpeg")).rejects.toThrow(/maxEdge/);
  });

  test("maxEdge: 0 is rejected, not silently ignored by the resize branch's truthiness check", async () => {
    const input = await jpegFixture(50, 50);
    await expect(renderImage(input, { maxEdge: 0 }, "image/jpeg")).rejects.toThrow(/maxEdge/);
  });

  test("a non-integer size.width throws", async () => {
    const input = await jpegFixture(50, 50);
    await expect(
      renderImage(input, { size: { width: 100.5, height: 100 } }, "image/jpeg"),
    ).rejects.toThrow(/size\.width/);
  });

  test("image/png ignores spec.quality instead of switching into lossy palette quantization", async () => {
    const input = await pngFixture(50, 50);
    const withQuality = await renderImage(input, { quality: 10 }, "image/png");
    const withoutQuality = await renderImage(input, {}, "image/png");
    const withQualityMeta = await sharp(withQuality).metadata();
    // A quality-driven palette encode would quantize to a small color count;
    // an ignored quality keeps the full-color (non-palette) PNG.
    expect(withQualityMeta.format).toBe("png");
    expect(Buffer.compare(withQuality, withoutQuality)).toBe(0);
  });
});

describe("imageMetadata", () => {
  test("returns width/height/format", async () => {
    const input = await jpegFixture(320, 240);
    const meta = await imageMetadata(input);
    expect(meta).toEqual({ width: 320, height: 240, format: "jpeg" });
  });

  test("returns auto-oriented dimensions for EXIF orientation 6", async () => {
    const input = await orientedJpegFixture(400, 200, 6);
    const meta = await imageMetadata(input);
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(400);
  });
});
