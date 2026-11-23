import { deflateSync } from "node:zlib";

// Occupies a 32 MiB decoder buffer, which is past the 16 MiB budget.
export const BOMB_DECODED_BYTES = 17 * 1024 * 1024;

const SPACE = 0x20;
const RUN_LENGTH_REPEAT_128_SPACES = [0x81, SPACE];
const RUN_LENGTH_END = 0x80;
const RUN_LENGTH_MAX_LITERAL = 128;

function ascii(text: string): Uint8Array {
  return Uint8Array.from(Buffer.from(text, "latin1"));
}

function flateBody(content: Uint8Array, decodedBytes: number): Uint8Array {
  const body = new Uint8Array(Math.max(decodedBytes, content.length)).fill(SPACE);
  body.set(content, 0);
  return deflateSync(body, { level: 9 });
}

function runLengthBody(content: Uint8Array, decodedBytes: number): Uint8Array {
  if (content.length > RUN_LENGTH_MAX_LITERAL) throw new Error("object stream header too long");
  const repeatPairs = Math.ceil(Math.max(decodedBytes - content.length, 0) / 128);
  const out = new Uint8Array(1 + content.length + repeatPairs * 2 + 1);
  out[0] = content.length - 1;
  out.set(content, 1);
  for (let pair = 0; pair < repeatPairs; pair++) {
    out.set(RUN_LENGTH_REPEAT_128_SPACES, 1 + content.length + pair * 2);
  }
  out[out.length - 1] = RUN_LENGTH_END;
  return out;
}

export function objectStreamPdf(options: {
  decodedBytesPerStream: number;
  streamCount: number;
  fillerObjects?: number;
  filter?: "FlateDecode" | "RunLengthDecode";
}): Uint8Array {
  const filter = options.filter ?? "FlateDecode";
  const parts: Uint8Array[] = [
    ascii("%PDF-1.7\n"),
    ascii("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"),
    ascii("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"),
    ascii("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.276 841.89] >>\nendobj\n"),
  ];
  for (let i = 0; i < (options.fillerObjects ?? 0); i++) {
    parts.push(ascii(`${10 + i} 0 obj\n<< /Filler ${i} >>\nendobj\n`));
  }
  for (let s = 0; s < options.streamCount; s++) {
    const header = `${500 + s} 0 `;
    const content = ascii(`${header}<< >>`);
    const data =
      filter === "FlateDecode"
        ? flateBody(content, options.decodedBytesPerStream)
        : runLengthBody(content, options.decodedBytesPerStream);
    parts.push(
      ascii(
        `${1000 + s} 0 obj\n<< /Type /ObjStm /N 1 /First ${header.length} /Filter /${filter} /Length ${data.length} >>\nstream\n`,
      ),
      data,
      ascii("\nendstream\nendobj\n"),
    );
  }
  parts.push(ascii("trailer\n<< /Root 1 0 R >>\n%%EOF\n"));
  return Uint8Array.from(Buffer.concat(parts));
}

const MINIMAL_OBJECTS =
  "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
  "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
  "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.276 841.89] >>\nendobj\n";

// An xref stream whose /Size and /Index promise far more entries than its empty body holds.
export function xrefStreamPdf(options: { size: string; index?: string }): Uint8Array {
  const index = options.index === undefined ? "" : ` /Index ${options.index}`;
  return ascii(
    `%PDF-1.7\n${MINIMAL_OBJECTS}4 0 obj\n<< /Type /XRef /Size ${options.size}${index} /W [0 0 0] /Root 1 0 R /Length 0 >>\nstream\n\nendstream\nendobj\n%%EOF\n`,
  );
}

// Every level lists the next level `fanout` times, so the leaf page is reachable fanout^depth times.
export function fanOutPageTreePdf(fanout: number, depth: number): Uint8Array {
  let text = "%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 10 0 R >>\nendobj\n";
  for (let level = 0; level < depth; level++) {
    const child = level === depth - 1 ? "3 0 R" : `${11 + level} 0 R`;
    const kids = Array(fanout).fill(child).join(" ");
    const parent = level === 0 ? "" : ` /Parent ${9 + level} 0 R`;
    text += `${10 + level} 0 obj\n<< /Type /Pages${parent} /Kids [${kids}] /Count 1 >>\nendobj\n`;
  }
  text += `3 0 obj\n<< /Type /Page /Parent ${9 + depth} 0 R /MediaBox [0 0 595.276 841.89] >>\nendobj\n`;
  text += "trailer\n<< /Root 1 0 R >>\n%%EOF\n";
  return ascii(text);
}

export function cyclicPageTreePdf(): Uint8Array {
  return ascii(
    "%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
      "2 0 obj\n<< /Type /Pages /Kids [3 0 R 2 0 R] /Count 1 >>\nendobj\n" +
      "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.276 841.89] >>\nendobj\n" +
      "trailer\n<< /Root 1 0 R >>\n%%EOF\n",
  );
}

export function pageListedTwicePdf(): Uint8Array {
  return ascii(
    "%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
      "2 0 obj\n<< /Type /Pages /Kids [3 0 R 3 0 R] /Count 2 >>\nendobj\n" +
      "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.276 841.89] >>\nendobj\n" +
      "trailer\n<< /Root 1 0 R >>\n%%EOF\n",
  );
}
