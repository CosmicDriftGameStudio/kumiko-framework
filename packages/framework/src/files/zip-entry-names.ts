const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const EOCD_MIN_LENGTH = 22;
const EOCD_MAX_COMMENT_LENGTH = 0xffff;
const CENTRAL_HEADER_FIXED_LENGTH = 46;

// Entry names from the central directory, which (unlike local headers) always
// carries sizes and names even for streamed ZIPs written with data descriptors.
// Returns null when the container is not a readable (non-ZIP64) ZIP.
export function readZipEntryNames(bytes: Uint8Array): readonly string[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEndOfCentralDirectory(view);
  if (eocdOffset === null) return null;

  const entryCount = view.getUint16(eocdOffset + 10, true);
  let offset = view.getUint32(eocdOffset + 16, true);
  const decoder = new TextDecoder();
  const names: string[] = [];
  for (let i = 0; i < entryCount; i++) {
    if (offset + CENTRAL_HEADER_FIXED_LENGTH > view.byteLength) return null;
    if (view.getUint32(offset, true) !== CENTRAL_HEADER_SIGNATURE) return null;
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameStart = offset + CENTRAL_HEADER_FIXED_LENGTH;
    if (nameStart + nameLength > view.byteLength) return null;
    names.push(decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)));
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  return names;
}

function findEndOfCentralDirectory(view: DataView): number | null {
  const lowest = Math.max(0, view.byteLength - EOCD_MIN_LENGTH - EOCD_MAX_COMMENT_LENGTH);
  for (let offset = view.byteLength - EOCD_MIN_LENGTH; offset >= lowest; offset--) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  return null;
}
