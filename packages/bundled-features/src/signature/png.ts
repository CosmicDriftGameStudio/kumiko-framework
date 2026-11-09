import { inflateSync } from "node:zlib";

export const MAX_SIGNATURE_PNG_BYTES = 300_000;
const MAX_DIMENSION = 3000;
const MIN_DIMENSION = 16;
const MAX_PIXELS = 4_000_000;
const MIN_INK_PIXELS = 20;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const COLOR_TYPE_GRAY_ALPHA = 4;
const COLOR_TYPE_RGBA = 6;
const BYTES_PER_PIXEL: Readonly<Record<number, number>> = {
  [COLOR_TYPE_GRAY_ALPHA]: 2,
  [COLOR_TYPE_RGBA]: 4,
};

export type SignaturePngCheck =
  | { readonly ok: true; readonly width: number; readonly height: number }
  | { readonly ok: false; readonly reason: string };

const rejected = (reason: string): SignaturePngCheck => ({ ok: false, reason });

type Header = {
  readonly width: number;
  readonly height: number;
  readonly bytesPerPixel: number;
};

function hasPngSignature(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

function readHeader(view: DataView): Header | string {
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const bitDepth = view.getUint8(24);
  const colorType = view.getUint8(25);
  const interlace = view.getUint8(28);
  const bytesPerPixel = BYTES_PER_PIXEL[colorType];
  if (bitDepth !== 8 || bytesPerPixel === undefined) return "unsupported_pixel_format";
  if (interlace !== 0) return "interlaced";
  if (width < MIN_DIMENSION || height < MIN_DIMENSION) return "too_small";
  if (width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
    return "too_large";
  }
  return { width, height, bytesPerPixel };
}

function collectImageData(bytes: Uint8Array, view: DataView): Uint8Array | null {
  const parts: Uint8Array[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const dataStart = offset + 8;
    if (dataStart + length + 4 > bytes.length) return null;
    if (type === "IDAT") parts.push(bytes.subarray(dataStart, dataStart + length));
    if (type === "IEND") break;
    offset = dataStart + length + 4;
  }
  if (parts.length === 0) return null;
  const joined = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let written = 0;
  for (const part of parts) {
    joined.set(part, written);
    written += part.length;
  }
  return joined;
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const distanceLeft = Math.abs(estimate - left);
  const distanceUp = Math.abs(estimate - up);
  const distanceUpLeft = Math.abs(estimate - upLeft);
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) return left;
  return distanceUp <= distanceUpLeft ? up : upLeft;
}

// Reverses one filtered byte; null for an unknown filter type.
function unfilterByte(
  filter: number | undefined,
  current: number,
  left: number,
  up: number,
  upLeft: number,
): number | null {
  switch (filter) {
    case 0:
      return current;
    case 1:
      return (current + left) & 0xff;
    case 2:
      return (current + up) & 0xff;
    case 3:
      return (current + ((left + up) >> 1)) & 0xff;
    case 4:
      return (current + paeth(left, up, upLeft)) & 0xff;
    default:
      return null;
  }
}

// Reverses the per-row PNG filters in place; returns false for an unknown filter type.
function unfilterRows(raw: Uint8Array, header: Header): boolean {
  const bpp = header.bytesPerPixel;
  const rowBytes = header.width * bpp;
  const stride = rowBytes + 1;
  for (let row = 0; row < header.height; row++) {
    const filter = raw[row * stride];
    const start = row * stride + 1;
    for (let i = 0; i < rowBytes; i++) {
      const left = i >= bpp ? (raw[start + i - bpp] ?? 0) : 0;
      const up = row > 0 ? (raw[start - stride + i] ?? 0) : 0;
      const upLeft = row > 0 && i >= bpp ? (raw[start - stride + i - bpp] ?? 0) : 0;
      const restored = unfilterByte(filter, raw[start + i] ?? 0, left, up, upLeft);
      if (restored === null) return false;
      raw[start + i] = restored;
    }
  }
  return true;
}

function countInkPixels(raw: Uint8Array, header: Header): number {
  const bytesPerPixel = header.bytesPerPixel;
  const stride = header.width * bytesPerPixel + 1;
  const pixelStart = (row: number, column: number): number =>
    row * stride + 1 + column * bytesPerPixel;
  const background = pixelStart(0, 0);
  const alphaOf = (start: number): number => raw[start + bytesPerPixel - 1] ?? 0;
  const colorMatchesBackground = (start: number): boolean => {
    for (let i = 0; i < bytesPerPixel; i++) {
      if (raw[start + i] !== raw[background + i]) return false;
    }
    return true;
  };
  // Only four identical, opaque corners mean a solid background; a single opaque pixel could be a stroke.
  const corners = [
    background,
    pixelStart(0, header.width - 1),
    pixelStart(header.height - 1, 0),
    pixelStart(header.height - 1, header.width - 1),
  ];
  const hasSolidBackground = corners.every(
    (corner) => alphaOf(corner) > 0 && colorMatchesBackground(corner),
  );
  let ink = 0;
  for (let row = 0; row < header.height; row++) {
    for (let column = 0; column < header.width; column++) {
      const start = pixelStart(row, column);
      const isInk = alphaOf(start) > 0 && (!hasSolidBackground || !colorMatchesBackground(start));
      if (isInk) ink++;
    }
  }
  return ink;
}

// A real PNG with an alpha channel and at least a few drawn pixels. Dimensions and the inflated
// size are capped before anything is decoded, so a crafted file cannot exhaust memory.
export function checkSignaturePng(bytes: Uint8Array): SignaturePngCheck {
  if (bytes.length > MAX_SIGNATURE_PNG_BYTES) return rejected("too_many_bytes");
  if (bytes.length < 33 || !hasPngSignature(bytes)) return rejected("not_a_png");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") return rejected("not_a_png");
  const header = readHeader(view);
  if (typeof header === "string") return rejected(header);

  const compressed = collectImageData(bytes, view);
  if (compressed === null) return rejected("no_image_data");
  const expectedLength = header.height * (header.width * header.bytesPerPixel + 1);
  let raw: Uint8Array;
  try {
    raw = new Uint8Array(inflateSync(compressed, { maxOutputLength: expectedLength }));
  } catch {
    return rejected("corrupt_image_data");
  }
  if (raw.length !== expectedLength) return rejected("corrupt_image_data");
  if (!unfilterRows(raw, header)) return rejected("corrupt_image_data");
  if (countInkPixels(raw, header) < MIN_INK_PIXELS) return rejected("empty");
  return { ok: true, width: header.width, height: header.height };
}

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

// The image arrives as base64 inside the JSON payload; the cap keeps the decode bounded.
export function decodeSignaturePngBase64(base64: string): Uint8Array | null {
  if (base64.length > Math.ceil((MAX_SIGNATURE_PNG_BYTES * 4) / 3) + 4) return null;
  if (!BASE64_PATTERN.test(base64)) return null;
  return new Uint8Array(Buffer.from(base64, "base64"));
}
