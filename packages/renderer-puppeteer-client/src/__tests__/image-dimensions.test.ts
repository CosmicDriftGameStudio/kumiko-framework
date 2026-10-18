import { describe, expect, test } from "bun:test";
import { readImageDimensions } from "../image-dimensions.ts";

describe("readImageDimensions", () => {
  test("reads the size of a JPEG after a leading APP0 segment", () => {
    const bytes = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x0c, 0x80,
      0x03, 0x20, 0x01, 0x01, 0x11, 0x00,
    ]);
    expect(readImageDimensions(bytes, "jpg")).toEqual({ width: 800, height: 3200 });
  });

  test("returns undefined for bytes that are not the declared format", () => {
    expect(readImageDimensions(new Uint8Array([1, 2, 3]), "png")).toBeUndefined();
    expect(readImageDimensions(new Uint8Array([1, 2, 3]), "jpg")).toBeUndefined();
  });
});
