const DEFAULT_MAX_EDGE = 2560;

// Raster formats a canvas can losslessly re-encode as themselves; anything
// else (heic, bmp, tiff, ...) falls back to jpeg. svg/gif are excluded
// upstream (vector/animation would be destroyed by a canvas re-encode).
const PRESERVED_TYPES = new Set(["image/png", "image/webp"]);
const OUTPUT_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function pickOutputType(inputType: string): string {
  return PRESERVED_TYPES.has(inputType) ? inputType : "image/jpeg";
}

// The server validates the upload's extension against its mimeType
// (mime_mismatch), so a re-encode that changes type must rename the file too.
function withMatchingExtension(fileName: string, outputType: string): string {
  const ext = OUTPUT_EXTENSIONS[outputType] ?? "jpg";
  const dot = fileName.lastIndexOf(".");
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  return `${base}.${ext}`;
}

// Downscales images before upload to a reasonable edge length (bandwidth)
// and drops EXIF/GPS as a side effect (canvas re-encode carries no
// metadata). Missing OffscreenCanvas/createImageBitmap (older browser), or a
// decode failure, leaves the file unchanged — no hard error before upload.
export async function resizeImageBeforeUpload(
  file: File,
  maxEdge = DEFAULT_MAX_EDGE,
): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (file.type === "image/svg+xml" || file.type === "image/gif") return file;
  if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap !== "function") {
    return file;
  }
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (ctx === null) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: pickOutputType(file.type), quality: 0.85 });
    // Name off the blob's actual type, not the requested one — a browser
    // without webp encoding support silently falls back to png, and naming
    // by the request would then store a lie (extension/mimeType both "webp"
    // over png bytes).
    const actualType = blob.type || file.type;
    const fileName =
      actualType === file.type ? file.name : withMatchingExtension(file.name, actualType);
    return new File([blob], fileName, { type: actualType });
  } catch {
    return file;
  }
}
