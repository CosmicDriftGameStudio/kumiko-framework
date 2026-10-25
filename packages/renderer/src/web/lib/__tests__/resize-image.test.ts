import { describe, expect, mock, test } from "bun:test";
import { resizeImageBeforeUpload } from "../resize-image.ts";

describe("resizeImageBeforeUpload", () => {
  test("leaves non-images unchanged", async () => {
    const file = new File(["hi"], "report.pdf", { type: "application/pdf" });
    const result = await resizeImageBeforeUpload(file);
    expect(result).toBe(file);
  });

  test("leaves the image unchanged when OffscreenCanvas is unavailable", async () => {
    const originalOffscreenCanvas = globalThis.OffscreenCanvas;
    // @ts-expect-error simulate a browser without OffscreenCanvas support
    globalThis.OffscreenCanvas = undefined;
    try {
      const file = new File(["hi"], "photo.jpg", { type: "image/jpeg" });
      const result = await resizeImageBeforeUpload(file);
      expect(result).toBe(file);
    } finally {
      globalThis.OffscreenCanvas = originalOffscreenCanvas;
    }
  });

  test("leaves SVGs unchanged (the vector would be destroyed during re-encoding)", async () => {
    const file = new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" });
    const result = await resizeImageBeforeUpload(file);
    expect(result).toBe(file);
  });

  test("leaves GIFs unchanged (the animation would collapse to a single frame)", async () => {
    const file = new File(["gif"], "anim.gif", { type: "image/gif" });
    const result = await resizeImageBeforeUpload(file);
    expect(result).toBe(file);
  });

  test("scales down to maxEdge and preserves the aspect ratio", async () => {
    const bitmap = { close: mock(() => {}), height: 2000, width: 4000 };
    let capturedWidth = 0;
    let capturedHeight = 0;
    class FakeOffscreenCanvas {
      constructor(w: number, h: number) {
        capturedWidth = w;
        capturedHeight = h;
      }
      getContext() {
        return { drawImage: mock(() => {}) };
      }
      convertToBlob() {
        return Promise.resolve(new Blob(["x"], { type: "image/jpeg" }));
      }
    }
    // @ts-expect-error test stub for a browser-only API missing in jsdom
    globalThis.OffscreenCanvas = FakeOffscreenCanvas;
    globalThis.createImageBitmap = mock(async () => bitmap);

    try {
      // Content sized well above the 1-byte re-encoded blob so the resize
      // wins the size-guard and the assertions below observe its output.
      const file = new File(["x".repeat(2000)], "photo.jpg", { type: "image/jpeg" });
      const result = await resizeImageBeforeUpload(file, 2560);
      expect(capturedWidth).toBe(2560);
      expect(capturedHeight).toBe(1280);
      expect(result.name).toBe("photo.jpg");
      expect(result.type).toBe("image/jpeg");
    } finally {
      // @ts-expect-error restore missing-API baseline
      globalThis.OffscreenCanvas = undefined;
      // @ts-expect-error restore missing-API baseline
      globalThis.createImageBitmap = undefined;
    }
  });

  test("converts non-preservable formats to jpeg and adjusts the extension", async () => {
    class FakeOffscreenCanvas {
      getContext() {
        return { drawImage: mock(() => {}) };
      }
      convertToBlob(opts: { type: string }) {
        return Promise.resolve(new Blob(["x"], { type: opts.type }));
      }
    }
    // @ts-expect-error test stub for a browser-only API missing in jsdom
    globalThis.OffscreenCanvas = FakeOffscreenCanvas;
    globalThis.createImageBitmap = mock(async () => ({
      close: mock(() => {}),
      height: 100,
      width: 100,
    }));

    try {
      // Content sized well above the 1-byte re-encoded blob so the resize
      // wins the size-guard and the assertions below observe its output.
      const file = new File(["x".repeat(2000)], "photo.heic", { type: "image/heic" });
      const result = await resizeImageBeforeUpload(file);
      expect(result.name).toBe("photo.jpg");
      expect(result.type).toBe("image/jpeg");
    } finally {
      // @ts-expect-error restore missing-API baseline
      globalThis.OffscreenCanvas = undefined;
      // @ts-expect-error restore missing-API baseline
      globalThis.createImageBitmap = undefined;
    }
  });

  test("releases the bitmap when no 2d context is available and returns the original", async () => {
    const bitmap = { close: mock(() => {}), height: 100, width: 100 };
    class NoContextCanvas {
      getContext() {
        return null;
      }
    }
    // @ts-expect-error test stub for a browser-only API missing in jsdom
    globalThis.OffscreenCanvas = NoContextCanvas;
    globalThis.createImageBitmap = mock(async () => bitmap);

    try {
      const file = new File(["x".repeat(2000)], "photo.jpg", { type: "image/jpeg" });
      const result = await resizeImageBeforeUpload(file);
      expect(result).toBe(file);
      expect(bitmap.close).toHaveBeenCalledTimes(1);
    } finally {
      // @ts-expect-error restore missing-API baseline
      globalThis.OffscreenCanvas = undefined;
      // @ts-expect-error restore missing-API baseline
      globalThis.createImageBitmap = undefined;
    }
  });

  test("names after the actually generated Blob type, not the requested one", async () => {
    // A browser without webp encoding support silently falls back to png
    // (spec behavior of convertToBlob) — naming must follow the blob, or a
    // ".webp" file ends up holding png bytes with a matching-looking mimeType.
    class FakeOffscreenCanvas {
      getContext() {
        return { drawImage: mock(() => {}) };
      }
      convertToBlob() {
        return Promise.resolve(new Blob(["x"], { type: "image/png" }));
      }
    }
    // @ts-expect-error test stub for a browser-only API missing in jsdom
    globalThis.OffscreenCanvas = FakeOffscreenCanvas;
    globalThis.createImageBitmap = mock(async () => ({
      close: mock(() => {}),
      height: 100,
      width: 100,
    }));

    try {
      // Content sized well above the 1-byte re-encoded blob so the resize
      // wins the size-guard and the assertions below observe its output.
      const file = new File(["x".repeat(2000)], "photo.webp", { type: "image/webp" });
      const result = await resizeImageBeforeUpload(file);
      expect(result.name).toBe("photo.png");
      expect(result.type).toBe("image/png");
    } finally {
      // @ts-expect-error restore missing-API baseline
      globalThis.OffscreenCanvas = undefined;
      // @ts-expect-error restore missing-API baseline
      globalThis.createImageBitmap = undefined;
    }
  });

  test("leaves an already optimized image unchanged if re-encoding would make it larger", async () => {
    // A small in-spec PNG (e.g. palette-optimized) round-tripped through a
    // canvas can come back as a bigger full-RGBA blob — the size guard must
    // then keep serving the original bytes instead of the larger re-encode.
    class FakeOffscreenCanvas {
      getContext() {
        return { drawImage: mock(() => {}) };
      }
      convertToBlob() {
        return Promise.resolve(new Blob(["x".repeat(2000)], { type: "image/png" }));
      }
    }
    // @ts-expect-error test stub for a browser-only API missing in jsdom
    globalThis.OffscreenCanvas = FakeOffscreenCanvas;
    globalThis.createImageBitmap = mock(async () => ({
      close: mock(() => {}),
      height: 100,
      width: 100,
    }));

    try {
      const file = new File(["x"], "photo.png", { type: "image/png" });
      const result = await resizeImageBeforeUpload(file);
      expect(result).toBe(file);
      expect(result.size).toBeLessThanOrEqual(file.size);
    } finally {
      // @ts-expect-error restore missing-API baseline
      globalThis.OffscreenCanvas = undefined;
      // @ts-expect-error restore missing-API baseline
      globalThis.createImageBitmap = undefined;
    }
  });

  test("falls back to the original file on decode errors", async () => {
    class FakeOffscreenCanvas {
      getContext() {
        return { drawImage: mock(() => {}) };
      }
    }
    // @ts-expect-error test stub for a browser-only API missing in jsdom
    globalThis.OffscreenCanvas = FakeOffscreenCanvas;
    globalThis.createImageBitmap = mock(async () => {
      throw new Error("unsupported format");
    });

    try {
      const file = new File(["x"], "photo.heic", { type: "image/heic" });
      const result = await resizeImageBeforeUpload(file);
      expect(result).toBe(file);
    } finally {
      // @ts-expect-error restore missing-API baseline
      globalThis.OffscreenCanvas = undefined;
      // @ts-expect-error restore missing-API baseline
      globalThis.createImageBitmap = undefined;
    }
  });
});
