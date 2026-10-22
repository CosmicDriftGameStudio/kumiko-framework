import { strFromU8, unzipSync } from "fflate";

export type SheetCell = {
  readonly ref: string;
  /** Raw `t` attribute: "s" = shared string, undefined = number. */
  readonly t: string | undefined;
  readonly style: string | undefined;
  /** Raw `<v>` content: the shared-string index for t="s". */
  readonly raw: string;
  /** Shared strings resolved; numbers stay their raw text. */
  readonly text: string;
};

export type ParsedSheet = {
  readonly rows: readonly (readonly SheetCell[])[];
  readonly hasFormula: boolean;
};

const XML_ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

function unescapeXml(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos);/g, (entity) => XML_ENTITIES[entity] ?? entity);
}

function readSharedStrings(xml: string | undefined): string[] {
  if (xml === undefined) return [];
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((si) =>
    unescapeXml([...(si[1] ?? "").matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")),
  );
}

export function readXlsx(bytes: ArrayBuffer): ParsedSheet {
  const files = unzipSync(new Uint8Array(bytes));
  const sheetXml = strFromU8(files["xl/worksheets/sheet1.xml"] ?? new Uint8Array());
  const sharedXml = files["xl/sharedStrings.xml"];
  const shared = readSharedStrings(sharedXml === undefined ? undefined : strFromU8(sharedXml));
  const rows = [...sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((row) =>
    [...(row[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((cell) => {
      const attrs = cell[1] ?? "";
      const raw = /<v>([\s\S]*?)<\/v>/.exec(cell[2] ?? "")?.[1] ?? "";
      const t = /\bt="([^"]*)"/.exec(attrs)?.[1];
      return {
        ref: /\br="([^"]*)"/.exec(attrs)?.[1] ?? "",
        t,
        style: /\bs="([^"]*)"/.exec(attrs)?.[1],
        raw,
        text: t === "s" ? (shared[Number(raw)] ?? "") : raw,
      } satisfies SheetCell;
    }),
  );
  return { rows, hasFormula: /<f[\s>]/.test(sheetXml) };
}
