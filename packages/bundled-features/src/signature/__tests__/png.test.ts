import { describe, expect, test } from "bun:test";
import { checkSignaturePng, decodeSignaturePngBase64, MAX_SIGNATURE_PNG_BYTES } from "../png.ts";
import { makePng, toBase64 } from "./png-fixture.ts";

describe("checkSignaturePng", () => {
  test("accepts a drawn signature", () => {
    expect(checkSignaturePng(makePng())).toEqual({ ok: true, width: 200, height: 80 });
  });

  test("rejects an empty (fully transparent) image", () => {
    expect(checkSignaturePng(makePng({ drawn: false })).ok).toBe(false);
  });

  test("rejects a fully opaque image without a stroke", () => {
    expect(checkSignaturePng(makePng({ drawn: false, background: [255, 255, 255, 255] })).ok).toBe(
      false,
    );
  });

  test("accepts a stroke drawn on an opaque background", () => {
    expect(checkSignaturePng(makePng({ background: [255, 255, 255, 255] })).ok).toBe(true);
  });

  test("rejects bytes that are not a PNG", () => {
    expect(checkSignaturePng(new TextEncoder().encode("GIF89a not a png")).ok).toBe(false);
    expect(checkSignaturePng(new Uint8Array()).ok).toBe(false);
  });

  test("rejects a truncated PNG", () => {
    expect(checkSignaturePng(makePng().subarray(0, 40)).ok).toBe(false);
  });

  test("rejects an image that is too small or too large in pixels", () => {
    expect(checkSignaturePng(makePng({ width: 8, height: 8 })).ok).toBe(false);
    expect(checkSignaturePng(makePng({ width: 4000, height: 40 })).ok).toBe(false);
  });

  test("rejects more bytes than the size limit", () => {
    const padded = new Uint8Array(MAX_SIGNATURE_PNG_BYTES + 1);
    padded.set(makePng());
    expect(checkSignaturePng(padded).ok).toBe(false);
  });
});

describe("decodeSignaturePngBase64", () => {
  test("round-trips valid base64", () => {
    const png = makePng();
    expect(decodeSignaturePngBase64(toBase64(png))).toEqual(png);
  });

  test("rejects text that is not base64 and data-URL prefixes", () => {
    expect(decodeSignaturePngBase64("not base64 !!")).toBeNull();
    expect(decodeSignaturePngBase64(`data:image/png;base64,${toBase64(makePng())}`)).toBeNull();
  });
});
