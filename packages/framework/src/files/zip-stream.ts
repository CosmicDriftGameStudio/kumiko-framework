import { getTemporal } from "../time";

// Streaming-ZIP-Builder (S2.U3 Atom 3a) — pure-JS, dependency-frei.
//
// **Format-Wahl: STORE (kein DEFLATE).** Compression-frei + minimal —
// fuer User-Data-Export-Bundles akzeptabel weil:
//   - Storage-Provider (S3/R2) komprimiert eh on-the-wire (HTTP gzip)
//   - JSON-Snippets sind klein, File-Binaries sind oft schon komprimiert
//     (PNG/JPG/PDF/MP4/...)
//   - DEFLATE braucht zlib + buffering pro Entry, killt das Streaming-
//     Property
//
// **Streaming-Property:** Caller gibt `AsyncIterable<ZipEntry>`, jeder
// Entry hat `data: AsyncIterable<Uint8Array>`. ZIP-Bytes werden
// chunk-fuer-chunk yieldet — kein Entry haengt im Memory bis er fertig
// ist. Storage-Provider's writeStream konsumiert direkt durch.
//
// **ZIP-Standard:** APPNOTE.TXT v6.3.10 (April 2022). STORE-Method,
// kein ZIP64 (max 4 GB pro Entry, max 65535 Entries — fuer User-Daten-
// Exports ausreichend; ZIP64-Support kommt wenn ein realer User mit
// >4 GB single-File auftaucht). Kein UTF-8-Flag (filenames sind ASCII
// in unserem Use-Case: "profile.json", "files/<id>.<ext>").
//
// **CRC32:** klassisches IEEE-802.3-Polynom (0xEDB88320). Lookup-Table
// einmal initialisiert + cached.

const ZIP_VERSION_NEEDED = 20; // 2.0 = STORE
const ZIP_METHOD_STORE = 0;

// Local file header signature: 0x04034b50 = "PK\x03\x04"
const LOCAL_FILE_HEADER_SIG = 0x04034b50;
// Central directory file header signature: 0x02014b50 = "PK\x01\x02"
const CENTRAL_DIR_HEADER_SIG = 0x02014b50;
// End of central directory record signature: 0x06054b50 = "PK\x05\x06"
const EOCD_SIG = 0x06054b50;

const VERSION_MADE_BY = 0x031e; // 0x03 = UNIX, 0x1e = ZIP 3.0

// General Purpose Flag Bit 11 (0x0800) = UTF-8 filename + comment encoding.
// Wird default-on gesetzt: ASCII ist gueltiges UTF-8, also Win-Win.
// Ohne Flag interpretieren aeltere ZIP-Tools filenames als CP437 — bei
// Umlauten ("Bügel.pdf") wird das Mojibake.
const GENERAL_PURPOSE_FLAGS = 0x0800;

// External-Attrs (UNIX-Mode in High-Bytes) fuer regulaere Dateien mit
// 0644-Permissions: `(S_IFREG | 0644) << 16 = 0o100644 << 16 = 0x81a40000`.
// S_IFREG = 0o100000 (regular file), 0o644 = rw-r--r--. Ohne diese
// Bits entpackt Info-ZIP mit Mode 0000 (EACCES beim Read).
const UNIX_REGULAR_FILE_0644 = 0o100644 << 16; // 0x81a40000

// ZIP-Format-Limits ohne ZIP64-Extension. Atom 3a-Scope ist STORE-only;
// ZIP64 kommt wenn ein realer User-Export diese Caps reisst.
const ZIP_MAX_ENTRY_SIZE = 0xffffffff; // uint32 → 4 GB
const ZIP_MAX_ENTRIES = 0xffff; // uint16 → 65535

export interface ZipEntry {
  /** Pfad im ZIP, slash-separated. ASCII (kein UTF-8-Flag gesetzt). */
  readonly path: string;
  /** Body als AsyncIterable — kann lazy generated sein (kein Upfront-Memory). */
  readonly data: AsyncIterable<Uint8Array>;
  /**
   * Optional Modification-Time. Default = Now. ZIP nutzt MS-DOS-Format
   * (2-Sek-Aufloesung). Wer Audit-Trail-Zeitpunkte haben will, setzt
   * den Generation-Timestamp ueber alle Entries.
   */
  readonly mtime?: InstanceType<ReturnType<typeof getTemporal>["Instant"]>;
}

/**
 * Erzeugt einen ZIP-Stream als `AsyncIterable<Uint8Array>`. Caller (z.B.
 * `FileStorageProvider.writeStream`) konsumiert chunk-fuer-chunk, kein
 * Entry haengt im Memory bis fertig.
 *
 * Streaming-Lifecycle pro Entry:
 *   1. Local File Header (mit CRC32+size=0 als Placeholder; wir nutzen
 *      KEINE Streaming-Data-Descriptor weil Storage-Provider Random-
 *      Access nicht garantiert — wir collecten den Body in Memory pro
 *      Entry um CRC + size **vor** dem Header zu kennen.
 *      Trade-off: 1 Entry-Body im Memory at-a-time; bei <100 MB Files
 *      OK, bei >1 GB single-Files braeuchte ZIP64+Streaming-Descriptor).
 *   2. File Body (raw bytes)
 * Am Ende:
 *   3. Central Directory (eine Liste-Entry pro File mit CRC + size)
 *   4. EOCD (End Of Central Directory)
 */
export async function* createZipStream(
  entries: AsyncIterable<ZipEntry>,
): AsyncIterable<Uint8Array> {
  const centralDirRecords: Uint8Array[] = [];
  let offset = 0; // Bytes-Counter fuer central-dir entry's local-header-offset

  for await (const entry of entries) {
    // Body in Memory collecten — wir brauchen CRC32 + size VOR dem
    // local-file-header (kein streaming-data-descriptor weil
    // file-storage-providers nicht zwingend seek-able sind, aber wir
    // wollen vermeiden dass der konsumierende Storage zwei-pass laesst).
    const body = await collectBody(entry.data);

    // Hard-Limit: STORE-Mode ohne ZIP64-Extension cappt bei uint32 (4 GB).
    // Bei Ueberschreitung wuerde der Integer-Wrap silent ein korruptes
    // ZIP produzieren (Decoder lesen Muell-Sizes). Lieber early-fail mit
    // klarer Begruendung — Worker (Atom 3b) fängt das + setzt Job=failed.
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

    // Central-Directory-Eintrag fuer diesen Entry — wir collecten ihn,
    // emittieren ihn am Ende.
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

  // Central Directory: alle entries hintereinander
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

// MS-DOS Date+Time encoding fuer ZIP-Header.
// Date: bits 9-15=year-1980, 5-8=month, 0-4=day.
// Time: bits 11-15=hour, 5-10=minute, 0-4=second/2.
//
// **UTC** statt lokaler Zeitzone: in einem DSGVO-Kontext ist der
// ZIP-mtime Teil des Auskunfts-Artefakts. Verschiedene Server-Zeitzonen
// wuerden sonst verschiedene mtime-Werte fuer denselben Generation-
// Instant produzieren — Audit-Drift. UTC ist der Standard fuer alle
// server-side-Timestamps im Repo (Temporal.Instant ueberall).
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
