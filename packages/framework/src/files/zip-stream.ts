import { getTemporal } from "../time/index.ts";

// Pure-JS streaming ZIP builder without dependencies.
//
// **Format: STORE (no DEFLATE).** Avoiding compression keeps the implementation minimal:
//   - Storage providers (S3/R2) compress data on the wire (HTTP gzip).
//   - JSON snippets are small, and file binaries are often already compressed
//     (PNG/JPG/PDF/MP4/...).
//   - DEFLATE requires zlib and per-entry buffering, which defeats streaming.
//
// **Streaming:** The caller provides `AsyncIterable<ZipEntry>`, and each entry
// has `data: AsyncIterable<Uint8Array>`. ZIP bytes are yielded chunk by chunk.
// The storage provider's writeStream consumes them directly.
//
// **ZIP standard:** APPNOTE.TXT v6.3.10 (April 2022). STORE method, no ZIP64
// (maximum 4 GB per entry and 65535 entries). ZIP64 support is needed before
// exporting a single file larger than 4 GB. The UTF-8 flag is enabled because
// filenames may contain non-ASCII characters.
//
// **CRC32:** Classic IEEE-802.3 polynomial (0xEDB88320), with a cached lookup table.

const ZIP_VERSION_NEEDED = 20; // 2.0 = STORE
const ZIP_METHOD_STORE = 0;

// Local file header signature: 0x04034b50 = "PK\x03\x04"
const LOCAL_FILE_HEADER_SIG = 0x04034b50;
// Central directory file header signature: 0x02014b50 = "PK\x01\x02"
const CENTRAL_DIR_HEADER_SIG = 0x02014b50;
// End of central directory record signature: 0x06054b50 = "PK\x05\x06"
const EOCD_SIG = 0x06054b50;

const VERSION_MADE_BY = 0x031e; // 0x03 = UNIX, 0x1e = ZIP 3.0

// General Purpose Flag Bit 11 (0x0800) enables UTF-8 encoding for filenames and comments.
// ASCII is valid UTF-8, while omitting the flag makes older ZIP tools interpret
// filenames as CP437, producing mojibake for non-ASCII characters such as umlauts.
const GENERAL_PURPOSE_FLAGS = 0x0800;

// Store UNIX file permissions in the high bytes of the external attributes.
// Without `(S_IFREG | 0644) << 16 = 0o100644 << 16 = 0x81a40000`, Info-ZIP
// extracts regular files with mode 0000, causing EACCES when they are read.
const UNIX_REGULAR_FILE_0644 = 0o100644 << 16; // 0x81a40000

// STORE without ZIP64 is limited to 4 GB per entry and 65535 entries.
// ZIP64 support is required before these limits can be exceeded.
const ZIP_MAX_ENTRY_SIZE = 0xffffffff; // uint32 → 4 GB
const ZIP_MAX_ENTRIES = 0xffff; // uint16 → 65535

export interface ZipEntry {
  /** Path inside the ZIP, slash-separated and UTF-8 encoded (general-purpose flag bit 11). */
  readonly path: string;
  /** Body as an AsyncIterable; it may be generated lazily to avoid upfront memory use. */
  readonly data: AsyncIterable<Uint8Array>;
  /**
   * Optional modification time. Defaults to the current time and uses the ZIP
   * MS-DOS format with two-second precision. Set the generation timestamp on
   * every entry when consistent audit-trail timestamps are required.
   */
  readonly mtime?: InstanceType<ReturnType<typeof getTemporal>["Instant"]>;
}

/**
 * Creates a ZIP stream as `AsyncIterable<Uint8Array>`. The caller, such as
 * `FileStorageProvider.writeStream`, consumes the output chunk by chunk.
 *
 * Each entry's body is collected in memory before its local file header is
 * emitted because non-seekable storage providers cannot use a streaming data
 * descriptor, and the header must contain the CRC32 and size. This limits
 * memory use to one entry body at a time; ZIP64 plus streaming descriptors
 * would be needed for larger single files.
 */
export async function* createZipStream(
  entries: AsyncIterable<ZipEntry>,
): AsyncIterable<Uint8Array> {
  const centralDirRecords: Uint8Array[] = [];
  let offset = 0; // Tracks the local-header offset for each central-directory entry

  for await (const entry of entries) {
    // Collect the body before writing the local file header: non-seekable storage
    // providers cannot use a streaming data descriptor, and a two-pass read
    // would be required otherwise.
    const body = await collectBody(entry.data);

    // STORE without ZIP64 uses uint32 sizes. Fail early instead of allowing integer
    // wraparound to produce a corrupt ZIP with incorrect sizes.
    if (body.byteLength > ZIP_MAX_ENTRY_SIZE) {
      throw new Error(
        `ZIP-Entry "${entry.path}" exceeds 4 GB limit (${body.byteLength} bytes). ` +
          `STORE-mode without ZIP64-extension caps at uint32. ` +
          `Add ZIP64-support before exporting >4 GB single-files.`,
      );
    }
    if (centralDirRecords.length >= ZIP_MAX_ENTRIES) {
      throw new Error(
        `ZIP archive exceeds ${ZIP_MAX_ENTRIES}-entry limit. ` +
          `Add ZIP64-support before exporting >${ZIP_MAX_ENTRIES} entries.`,
      );
    }

    const crc = crc32(body);
    const size = body.byteLength;
    const filenameBytes = new TextEncoder().encode(entry.path);
    const dosTime = toDosTime(entry.mtime ?? getTemporal().Now.instant());

    // Local File Header
    const lfh = new Uint8Array(30 + filenameBytes.byteLength);
    const lfhView = new DataView(lfh.buffer);
    lfhView.setUint32(0, LOCAL_FILE_HEADER_SIG, true);
    lfhView.setUint16(4, ZIP_VERSION_NEEDED, true);
    lfhView.setUint16(6, GENERAL_PURPOSE_FLAGS, true);
    lfhView.setUint16(8, ZIP_METHOD_STORE, true);
    lfhView.setUint16(10, dosTime.time, true);
    lfhView.setUint16(12, dosTime.date, true);
    lfhView.setUint32(14, crc, true);
    lfhView.setUint32(18, size, true); // compressed size = uncompressed (STORE)
    lfhView.setUint32(22, size, true);
    lfhView.setUint16(26, filenameBytes.byteLength, true);
    lfhView.setUint16(28, 0, true); // extra field length
    lfh.set(filenameBytes, 30);

    yield lfh;
    yield body;

    // Keep central-directory entries until all file bodies have been emitted.
    const cdh = new Uint8Array(46 + filenameBytes.byteLength);
    const cdhView = new DataView(cdh.buffer);
    cdhView.setUint32(0, CENTRAL_DIR_HEADER_SIG, true);
    cdhView.setUint16(4, VERSION_MADE_BY, true);
    cdhView.setUint16(6, ZIP_VERSION_NEEDED, true);
    cdhView.setUint16(8, GENERAL_PURPOSE_FLAGS, true);
    cdhView.setUint16(10, ZIP_METHOD_STORE, true);
    cdhView.setUint16(12, dosTime.time, true);
    cdhView.setUint16(14, dosTime.date, true);
    cdhView.setUint32(16, crc, true);
    cdhView.setUint32(20, size, true);
    cdhView.setUint32(24, size, true);
    cdhView.setUint16(28, filenameBytes.byteLength, true);
    cdhView.setUint16(30, 0, true); // extra field length
    cdhView.setUint16(32, 0, true); // comment length
    cdhView.setUint16(34, 0, true); // disk number start
    cdhView.setUint16(36, 0, true); // internal file attrs
    cdhView.setUint32(38, UNIX_REGULAR_FILE_0644, true);
    cdhView.setUint32(42, offset, true); // local-header-offset
    cdh.set(filenameBytes, 46);
    centralDirRecords.push(cdh);

    offset += lfh.byteLength + body.byteLength;
  }

  // Central directory: all entries back to back.
  const centralDirStart = offset;
  let centralDirSize = 0;
  for (const record of centralDirRecords) {
    yield record;
    centralDirSize += record.byteLength;
  }

  // EOCD (End Of Central Directory)
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, EOCD_SIG, true);
  eocdView.setUint16(4, 0, true); // disk number
  eocdView.setUint16(6, 0, true); // disk where central-dir starts
  eocdView.setUint16(8, centralDirRecords.length, true); // entries on this disk
  eocdView.setUint16(10, centralDirRecords.length, true); // total entries
  eocdView.setUint32(12, centralDirSize, true);
  eocdView.setUint32(16, centralDirStart, true);
  eocdView.setUint16(20, 0, true); // .zip comment length
  yield eocd;
}

async function collectBody(source: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of source) {
    chunks.push(chunk);
    total += chunk.byteLength;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

// CRC32 — IEEE-802.3-Polynom (0xEDB88320, reversed). Lookup-Table einmal.
let CRC32_TABLE: Uint32Array | null = null;
function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
}

function crc32(data: Uint8Array): number {
  if (!CRC32_TABLE) CRC32_TABLE = buildCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < data.byteLength; i++) {
    const byte = data[i] ?? 0;
    const idx = (crc ^ byte) & 0xff;
    crc = ((CRC32_TABLE[idx] ?? 0) ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// MS-DOS date and time encoding for ZIP headers.
// Date: bits 9-15 = year - 1980, 5-8 = month, 0-4 = day.
// Time: bits 11-15 = hour, 5-10 = minute, 0-4 = second / 2.
//
// **UTC** instead of the local time zone: in a GDPR context the ZIP mtime is
// part of the data-access export. Different server time zones would otherwise produce
// different values for the same generation instant, causing audit drift. UTC is
// used for server-side timestamps throughout the repository.
function toDosTime(i: InstanceType<ReturnType<typeof getTemporal>["Instant"]>): {
  date: number;
  time: number;
} {
  const dt = i.toZonedDateTimeISO("UTC");
  const year = dt.year;
  const date =
    (((Math.max(year - 1980, 0) & 0x7f) << 9) | ((dt.month & 0x0f) << 5) | (dt.day & 0x1f)) >>> 0;
  const time =
    (((dt.hour & 0x1f) << 11) | ((dt.minute & 0x3f) << 5) | ((dt.second >> 1) & 0x1f)) >>> 0;
  return { date, time };
}
