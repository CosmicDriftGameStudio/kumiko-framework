import { describe, expect, test } from "bun:test";
import {
  DEFAULT_IMAGE_FIELD_ACCEPT,
  resolveServedContentType,
  SNIFF_PREFIX_BYTE_COUNT,
  sniffMimeType,
  validateFile,
  validateFileContent,
  verifyDeclaredMimeType,
} from "../types.ts";

const fromHex = (hex: string): Uint8Array => Uint8Array.from(Buffer.from(hex, "hex"));

// ftyp boxes copied from real encoder output
const APPLE_HEIC = fromHex(
  "000000246674797068656963000000006d6966314d6950726d6961664d69484268656963",
);
const APPLE_AVIF = fromHex("000000206674797061766966000000004d695072617669666d6961666d696631");
const LIBHEIF_AVIF = fromHex("0000001c6674797061766966000000006d696631617669666d696166");
const FFMPEG_ANIMATED_AVIF = fromHex(
  "0000002c66747970617669730000000061766973617669666d73663169736f386d6966316d6961664d413142",
);
const FFMPEG_MP4 = fromHex("000000206674797069736f6d0000020069736f6d69736f32617663316d703431");
const FFMPEG_MOV = fromHex("0000001466747970717420200000020071742020");
const FFMPEG_M4A = fromHex("0000001c667479704d344120000002004d34412069736f6d69736f32");

const encoder = new TextEncoder();
const HTML_BYTES = encoder.encode("<html></html>");
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);

function ftypBox(
  majorBrand: string,
  compatibleBrands: readonly string[],
  boxSize?: number,
): Uint8Array {
  const size = 16 + compatibleBrands.length * 4;
  const box = new Uint8Array(size);
  new DataView(box.buffer).setUint32(0, boxSize ?? size);
  box.set(encoder.encode("ftyp"), 4);
  box.set(encoder.encode(majorBrand), 8);
  box.set(encoder.encode(compatibleBrands.join("")), 16);
  return box;
}

const brandCases: readonly [string, Uint8Array, string | null][] = [
  ["mif1 major, heic compatible", ftypBox("mif1", ["mif1", "heic"]), "image/heic"],
  ["heix major", ftypBox("heix", ["mif1", "heix"]), "image/heic"],
  ["msf1 major with heic", ftypBox("msf1", ["msf1", "mif1", "heic", "hevc"]), "image/heic"],
  ["mif1 only", ftypBox("mif1", ["mif1", "miaf"]), "image/heif"],
  ["mif1 with avif", ftypBox("mif1", ["mif1", "avif", "miaf"]), "image/avif"],
  ["hevc sequence only", ftypBox("hevc", ["hevc", "msf1"]), null],
  ["msf1 sequence only", ftypBox("msf1", ["msf1", "iso8"]), null],
  ["mp42 with hvc1", ftypBox("mp42", ["mp42", "isom", "hvc1"]), null],
];

const boundaryCases: readonly [string, Uint8Array, string | null][] = [
  ["brand beyond the box size", ftypBox("isom", ["isom", "heic"], 20), null],
  [
    "12th compatible brand",
    ftypBox("isom", [...Array<string>(11).fill("xxxx"), "heic"]),
    "image/heic",
  ],
  ["13th compatible brand", ftypBox("isom", [...Array<string>(12).fill("xxxx"), "heic"]), null],
  ["truncated to 8 bytes", APPLE_HEIC.subarray(0, 8), null],
  ["truncated to 12 bytes", APPLE_HEIC.subarray(0, 12), "image/heic"],
];

describe("sniffMimeType for ISO-BMFF", () => {
  test("real still-image headers are recognised", () => {
    expect(sniffMimeType(APPLE_HEIC)).toBe("image/heic");
    expect(sniffMimeType(APPLE_AVIF)).toBe("image/avif");
    expect(sniffMimeType(LIBHEIF_AVIF)).toBe("image/avif");
    expect(sniffMimeType(FFMPEG_ANIMATED_AVIF)).toBe("image/avif");
  });

  test("video and audio in the same container are not images", () => {
    expect(sniffMimeType(FFMPEG_MP4)).toBeNull();
    expect(sniffMimeType(FFMPEG_MOV)).toBeNull();
    expect(sniffMimeType(FFMPEG_M4A)).toBeNull();
  });

  test.each(brandCases)("brand table: %s", (_name, bytes, expected) => {
    expect(sniffMimeType(bytes)).toBe(expected);
  });

  test.each(boundaryCases)("boundary: %s", (_name, bytes, expected) => {
    expect(sniffMimeType(bytes)).toBe(expected);
  });

  test("the serve-path prefix gives the same result as the whole file", () => {
    const all = [
      APPLE_HEIC,
      APPLE_AVIF,
      LIBHEIF_AVIF,
      FFMPEG_ANIMATED_AVIF,
      FFMPEG_MP4,
      FFMPEG_MOV,
      FFMPEG_M4A,
      ...brandCases.map(([, bytes]) => bytes),
      ...boundaryCases.map(([, bytes]) => bytes),
    ];
    for (const bytes of all) {
      expect(sniffMimeType(bytes)).toBe(sniffMimeType(bytes.subarray(0, SNIFF_PREFIX_BYTE_COUNT)));
    }
  });
});

describe("validateFileContent for heic, heif and avif", () => {
  test("an mp4 named .heic is rejected as content_mismatch", () => {
    const result = validateFileContent("clip.heic", FFMPEG_MP4, DEFAULT_IMAGE_FIELD_ACCEPT);
    expect(result.kind).toBe("rejected");
    expect(result.kind === "rejected" ? result.error : "").toContain("content_mismatch");
  });

  test("HTML named .avif is rejected", () => {
    expect(validateFileContent("page.avif", HTML_BYTES, DEFAULT_IMAGE_FIELD_ACCEPT).kind).toBe(
      "rejected",
    );
  });

  test("matching bytes are ok", () => {
    expect(validateFileContent("photo.heic", APPLE_HEIC, DEFAULT_IMAGE_FIELD_ACCEPT)).toEqual({
      kind: "ok",
    });
    expect(validateFileContent("photo.heif", APPLE_HEIC, DEFAULT_IMAGE_FIELD_ACCEPT)).toEqual({
      kind: "ok",
    });
    expect(validateFileContent("photo.avif", LIBHEIF_AVIF, DEFAULT_IMAGE_FIELD_ACCEPT)).toEqual({
      kind: "ok",
    });
  });

  test("other image bytes under .heic are normalized to their real type", () => {
    expect(validateFileContent("photo.heic", JPEG_BYTES, DEFAULT_IMAGE_FIELD_ACCEPT)).toEqual({
      kind: "normalized",
      extension: "jpg",
      mimeType: "image/jpeg",
    });
    expect(validateFileContent("photo.heic", APPLE_AVIF, DEFAULT_IMAGE_FIELD_ACCEPT)).toEqual({
      kind: "normalized",
      extension: "avif",
      mimeType: "image/avif",
    });
  });

  test("heic bytes on a png-only field are rejected", () => {
    expect(validateFileContent("photo.png", APPLE_HEIC, ["png"]).kind).toBe("rejected");
  });
});

describe("validateFile for heic and heif", () => {
  const options = { accept: DEFAULT_IMAGE_FIELD_ACCEPT };

  test("heic and heif take both declared types", () => {
    expect(
      validateFile({ fileName: "photo.heic", mimeType: "image/heif", size: 10 }, options),
    ).toBeNull();
    expect(
      validateFile({ fileName: "photo.heif", mimeType: "image/heic", size: 10 }, options),
    ).toBeNull();
  });

  test("a png type on .heic is a mime_mismatch", () => {
    expect(
      validateFile({ fileName: "photo.heic", mimeType: "image/png", size: 10 }, options),
    ).toContain("mime_mismatch");
  });
});

describe("verifyDeclaredMimeType for heic, heif and avif", () => {
  test("matching bytes stay unchanged", () => {
    expect(verifyDeclaredMimeType("image/heic", APPLE_HEIC)).toEqual({ kind: "unchanged" });
    expect(verifyDeclaredMimeType("image/avif", LIBHEIF_AVIF)).toEqual({ kind: "unchanged" });
  });

  test("HTML and mp4 bytes are downgraded to octet-stream", () => {
    const downgraded = { kind: "replaced", mimeType: "application/octet-stream" } as const;
    expect(verifyDeclaredMimeType("image/heic", HTML_BYTES)).toEqual(downgraded);
    expect(verifyDeclaredMimeType("image/heic", FFMPEG_MP4)).toEqual(downgraded);
  });

  test("heic bytes declared as heif are replaced with heic", () => {
    expect(verifyDeclaredMimeType("image/heif", APPLE_HEIC, DEFAULT_IMAGE_FIELD_ACCEPT)).toEqual({
      kind: "replaced",
      mimeType: "image/heic",
      extension: "heic",
    });
  });

  test("heic bytes declared as png on a png-only field are rejected", () => {
    expect(verifyDeclaredMimeType("image/png", APPLE_HEIC, ["png"]).kind).toBe("rejected");
  });
});

describe("resolveServedContentType for heic and avif", () => {
  const serve = (bytes: Uint8Array, declared: string): string =>
    resolveServedContentType(bytes.subarray(0, SNIFF_PREFIX_BYTE_COUNT), declared);

  test("agreeing bytes and type are served as the image type", () => {
    expect(serve(APPLE_HEIC, "image/heic")).toBe("image/heic");
    expect(serve(APPLE_AVIF, "image/avif")).toBe("image/avif");
  });

  test("contradicting bytes and type are served as octet-stream", () => {
    expect(serve(FFMPEG_MP4, "image/heic")).toBe("application/octet-stream");
    expect(serve(APPLE_HEIC, "image/heif")).toBe("application/octet-stream");
  });
});
