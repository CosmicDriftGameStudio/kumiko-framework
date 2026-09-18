// Real sharp roundtrips — no mocked pipeline. Fixtures are built with
// `sharp({ create: {...} })` so every case decodes real bytes end-to-end.

import { describe, expect, test } from "bun:test";
import type {
  ResolvedOverlayLayer,
  VariantSpec,
} from "@cosmicdrift/kumiko-types/derivatives-types";
import jsQR from "jsqr";
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

// jsQR needs a plain RGBA buffer, not sharp's own metadata/format handling —
// this is the one test proving the AC ("readable with a phone camera") for
// real: a pixel/byte-presence check would only prove placement, not that the
// QR survives resize + a lossy re-encode.
async function decodeQr(buffer: Uint8Array): Promise<string | null> {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const result = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  return result?.data ?? null;
}

async function tinyImageOverlayBase64(
  width: number,
  height: number,
  color: { r: number; g: number; b: number },
): Promise<string> {
  const buffer = await sharp({ create: { width, height, channels: 3, background: color } })
    .png()
    .toBuffer();
  return buffer.toString("base64");
}

describe("renderImage — overlays", () => {
  test("a qr overlay is actually scannable after resize + a lossy re-encode", async () => {
    const input = await jpegFixture(800, 800);
    const layer: ResolvedOverlayLayer = {
      kind: "qr",
      data: "https://example.com/v/abc123",
      widthPct: 0.4,
      gravity: "south-east",
    };

    const output = await renderImage(
      input,
      { maxEdge: 400, format: "webp", resolvedOverlays: [layer] },
      "image/jpeg",
    );

    expect(await decodeQr(output)).toBe("https://example.com/v/abc123");
  });

  test("an unresolved `overlays` field is inert for the renderer — only `resolvedOverlays` composites", async () => {
    const input = await jpegFixture(400, 400);
    const spec: VariantSpec = {
      overlays: [{ kind: "qr", dataToken: "vehicle-1", widthPct: 0.4, gravity: "center" }],
    };

    const output = await renderImage(input, spec, "image/jpeg");
    const baseline = await renderImage(input, {}, "image/jpeg");
    expect(Buffer.compare(output, baseline)).toBe(0);
  });

  test("the overlay width is the same fraction of the output at two different aspect ratios", async () => {
    // PNG in and out (spec.format unset preserves the source format) — the
    // fraction assertion below needs exact pixel equality, which a lossy
    // jpeg re-encode wouldn't guarantee.
    const input = await pngFixture(800, 800, { r: 250, g: 250, b: 250 });
    const overlayColor = { r: 10, g: 200, b: 10 };
    const imageBase64 = await tinyImageOverlayBase64(40, 40, overlayColor);
    const layer: ResolvedOverlayLayer = {
      kind: "image",
      imageBase64,
      widthPct: 0.25,
      gravity: "south-east",
    };

    async function overlayPixelWidth(width: number, height: number): Promise<number> {
      const output = await renderImage(
        input,
        { size: { width, height }, fit: "cover", resolvedOverlays: [layer] },
        "image/png",
      );
      const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
      const y = height - 1;
      for (let x = 0; x < width; x++) {
        const offset = (y * info.width + x) * info.channels;
        if (
          data[offset] === overlayColor.r &&
          data[offset + 1] === overlayColor.g &&
          data[offset + 2] === overlayColor.b
        ) {
          return width - x;
        }
      }
      throw new Error("overlay color not found in bottom row");
    }

    expect(await overlayPixelWidth(640, 360)).toBe(Math.round(640 * 0.25));
    expect(await overlayPixelWidth(400, 400)).toBe(Math.round(400 * 0.25));
  });

  test("a square overlay on a wide output is clamped to the output height instead of overrunning it", async () => {
    // widthPct alone would ask for an 800x800 layer (aspect-preserved from a
    // square source) on a 1600x400 output — taller than the base image, which
    // sharp's composite() rejects unless the resize also bounds height.
    const outputWidth = 1600;
    const outputHeight = 400;
    const input = await pngFixture(outputWidth, outputHeight, { r: 250, g: 250, b: 250 });
    const overlayColor = { r: 10, g: 200, b: 10 };
    const imageBase64 = await tinyImageOverlayBase64(100, 100, overlayColor);
    const layer: ResolvedOverlayLayer = {
      kind: "image",
      imageBase64,
      widthPct: 0.5,
      gravity: "center",
    };

    const output = await renderImage(input, { resolvedOverlays: [layer] }, "image/png");
    const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });

    const centerX = Math.floor(info.width / 2);
    let minY = info.height;
    let maxY = -1;
    for (let y = 0; y < info.height; y++) {
      const offset = (y * info.width + centerX) * info.channels;
      if (
        data[offset] === overlayColor.r &&
        data[offset + 1] === overlayColor.g &&
        data[offset + 2] === overlayColor.b
      ) {
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }

    expect(maxY).toBeGreaterThan(-1);
    expect(maxY - minY + 1).toBeLessThanOrEqual(outputHeight);
  });

  test("an SVG overlay layer is rejected the same way a source SVG is", async () => {
    const input = await jpegFixture(200, 200);
    const layer: ResolvedOverlayLayer = {
      kind: "image",
      imageBase64: Buffer.from(SVG_BYTES).toString("base64"),
      widthPct: 0.3,
      gravity: "center",
    };

    await expect(renderImage(input, { resolvedOverlays: [layer] }, "image/jpeg")).rejects.toThrow(
      /svg/i,
    );
  });

  test("more than MAX_OVERLAY_LAYERS throws instead of decoding+resizing each one", async () => {
    const input = await jpegFixture(200, 200);
    const overlays: ResolvedOverlayLayer[] = Array.from({ length: 9 }, () => ({
      kind: "image",
      imageBase64: "",
      widthPct: 0.1,
      gravity: "center",
    }));

    await expect(renderImage(input, { resolvedOverlays: overlays }, "image/jpeg")).rejects.toThrow(
      /overlays has 9 entries/,
    );
  });

  test("widthPct outside (0, 1] throws", async () => {
    const input = await jpegFixture(200, 200);
    const layer: ResolvedOverlayLayer = {
      kind: "image",
      imageBase64: await tinyImageOverlayBase64(10, 10, { r: 1, g: 1, b: 1 }),
      widthPct: 1.5,
      gravity: "center",
    };

    await expect(renderImage(input, { resolvedOverlays: [layer] }, "image/jpeg")).rejects.toThrow(
      /widthPct/,
    );
  });

  test("marginPct outside [0, 0.5) throws", async () => {
    const input = await jpegFixture(200, 200);
    const layer: ResolvedOverlayLayer = {
      kind: "image",
      imageBase64: await tinyImageOverlayBase64(10, 10, { r: 1, g: 1, b: 1 }),
      widthPct: 0.2,
      marginPct: 0.5,
      gravity: "north-west",
    };

    await expect(renderImage(input, { resolvedOverlays: [layer] }, "image/jpeg")).rejects.toThrow(
      /marginPct/,
    );
  });

  test("a qr data length beyond MAX_QR_DATA_LENGTH throws", async () => {
    const input = await jpegFixture(200, 200);
    const layer: ResolvedOverlayLayer = {
      kind: "qr",
      data: "x".repeat(1025),
      widthPct: 0.3,
      gravity: "center",
    };

    await expect(renderImage(input, { resolvedOverlays: [layer] }, "image/jpeg")).rejects.toThrow(
      /qr overlay data length/,
    );
  });

  test("an empty qr data throws instead of encoding an empty QR", async () => {
    const input = await jpegFixture(200, 200);
    const layer: ResolvedOverlayLayer = { kind: "qr", data: "", widthPct: 0.3, gravity: "center" };

    await expect(renderImage(input, { resolvedOverlays: [layer] }, "image/jpeg")).rejects.toThrow(
      /qr overlay data length/,
    );
  });

  test("an overlay image beyond MAX_OVERLAY_IMAGE_BYTES throws", async () => {
    const input = await jpegFixture(200, 200);
    const oversized = Buffer.alloc(513 * 1024, 1).toString("base64");
    const layer: ResolvedOverlayLayer = {
      kind: "image",
      imageBase64: oversized,
      widthPct: 0.3,
      gravity: "center",
    };

    await expect(renderImage(input, { resolvedOverlays: [layer] }, "image/jpeg")).rejects.toThrow(
      /overlay image is/,
    );
  });

  test("a qr overlay that would render below MIN_QR_PIXEL_WIDTH throws instead of caching an unscannable image", async () => {
    const input = await jpegFixture(200, 200);
    const layer: ResolvedOverlayLayer = {
      kind: "qr",
      data: "https://example.com/v/abc123",
      widthPct: 0.05,
      gravity: "center",
    };

    await expect(
      renderImage(input, { maxEdge: 200, resolvedOverlays: [layer] }, "image/jpeg"),
    ).rejects.toThrow(/below the 160px minimum/);
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
