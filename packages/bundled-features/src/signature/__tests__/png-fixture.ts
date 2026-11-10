import { deflateSync } from "node:zlib";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + data.length);
  body.set(new TextEncoder().encode(type), 0);
  body.set(data, 4);
  const out = new Uint8Array(8 + data.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(8 + data.length, crc32(body));
  return out;
}

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// RGBA, 8 bit, no interlace. `drawn` paints a thick diagonal stroke; without it the image is fully transparent.
export function makePng(
  options: {
    width?: number;
    height?: number;
    drawn?: boolean;
    background?: readonly number[];
    // Shifts the stroke down so it stays clear of the (0,0) corner pixel.
    strokeRowOffset?: number;
    // Paints only the (0,0) pixel opaque and nothing else.
    onlyFirstPixelOpaque?: boolean;
    // Overwrites the (0,0) pixel after the background and the stroke are painted.
    firstPixel?: readonly number[];
  } = {},
): Uint8Array {
  const width = options.width ?? 200;
  const height = options.height ?? 80;
  const stride = 1 + width * 4;
  const raw = new Uint8Array(stride * height);
  if (options.background !== undefined) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) raw.set(options.background, y * stride + 1 + x * 4);
    }
  }
  if (options.onlyFirstPixelOpaque === true) raw.set([0, 0, 0, 255], 1);
  if (options.drawn !== false && options.onlyFirstPixelOpaque !== true) {
    const rowOffset = options.strokeRowOffset ?? 0;
    for (let x = 0; x < width; x++) {
      const y = Math.floor((x * (height - 1 - rowOffset)) / width) + rowOffset;
      for (let dy = 0; dy < 3 && y + dy < height; dy++) {
        const offset = (y + dy) * stride + 1 + x * 4;
        raw.set([0, 0, 0, 255], offset);
      }
    }
  }
  if (options.firstPixel !== undefined) raw.set(options.firstPixel, 1);
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);
  const parts = [
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ];
  const png = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}
