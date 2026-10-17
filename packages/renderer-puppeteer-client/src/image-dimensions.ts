// The service screenshots with fullPage, so the image is as tall as the document and the
// requested viewport size would misreport it. Reads the real size from the image header.

export type ImageDimensions = { readonly width: number; readonly height: number };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_IHDR_OFFSET = 16;
// SOF0..SOF15 carry the frame size, except DHT (C4), JPG (C8) and DAC (CC).
const JPEG_NON_FRAME_MARKERS = new Set([0xc4, 0xc8, 0xcc]);

function readPngDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.byteLength < PNG_IHDR_OFFSET + 8) return undefined;
  if (!PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    width: view.getUint32(PNG_IHDR_OFFSET),
    height: view.getUint32(PNG_IHDR_OFFSET + 4),
  };
}

function readJpegDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 9 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) return undefined;
    const marker = bytes[offset + 1] ?? 0;
    const isFrameHeader = marker >= 0xc0 && marker <= 0xcf && !JPEG_NON_FRAME_MARKERS.has(marker);
    if (isFrameHeader) {
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    }
    offset += 2 + view.getUint16(offset + 2);
  }
  return undefined;
}

export function readImageDimensions(
  bytes: Uint8Array,
  format: "png" | "jpg",
): ImageDimensions | undefined {
  return format === "png" ? readPngDimensions(bytes) : readJpegDimensions(bytes);
}
