const LOCAL_HEADER_FIXED_LENGTH = 30;
const CENTRAL_HEADER_FIXED_LENGTH = 46;
const EOCD_LENGTH = 22;

// Minimal stored ZIP (no compression, zero CRC): enough structure for readers that
// walk the central directory. Not for extraction.
export function zipWithEntries(...entryNames: readonly string[]): Uint8Array {
  const encoder = new TextEncoder();
  const names = entryNames.map((name) => encoder.encode(name));
  const localSize = names.reduce((sum, name) => sum + LOCAL_HEADER_FIXED_LENGTH + name.length, 0);
  const centralSize = names.reduce(
    (sum, name) => sum + CENTRAL_HEADER_FIXED_LENGTH + name.length,
    0,
  );
  const bytes = new Uint8Array(localSize + centralSize + EOCD_LENGTH);
  const view = new DataView(bytes.buffer);

  let localOffset = 0;
  let centralOffset = localSize;
  for (const name of names) {
    view.setUint32(localOffset, 0x04034b50, true);
    view.setUint16(localOffset + 26, name.length, true);
    bytes.set(name, localOffset + LOCAL_HEADER_FIXED_LENGTH);

    view.setUint32(centralOffset, 0x02014b50, true);
    view.setUint16(centralOffset + 28, name.length, true);
    view.setUint32(centralOffset + 42, localOffset, true);
    bytes.set(name, centralOffset + CENTRAL_HEADER_FIXED_LENGTH);

    localOffset += LOCAL_HEADER_FIXED_LENGTH + name.length;
    centralOffset += CENTRAL_HEADER_FIXED_LENGTH + name.length;
  }

  const eocdOffset = localSize + centralSize;
  view.setUint32(eocdOffset, 0x06054b50, true);
  view.setUint16(eocdOffset + 8, names.length, true);
  view.setUint16(eocdOffset + 10, names.length, true);
  view.setUint32(eocdOffset + 12, centralSize, true);
  view.setUint32(eocdOffset + 16, localSize, true);
  return bytes;
}
