import { withParsedDocument } from "./document-sanitizer.ts";

export type TemplateDiffChange = "same" | "added" | "removed";

export type TemplateDiffBlock = { readonly change: TemplateDiffChange; readonly content: string };

// Beyond this the quadratic LCS table is not worth it for a preview.
const MAX_LCS_CELLS = 1_000_000;

function splitHtmlBlocks(content: string): string[] {
  return withParsedDocument(content, (body) => {
    const blocks: string[] = [];
    for (const node of Array.from(body.childNodes)) {
      const markup =
        "outerHTML" in node && typeof node.outerHTML === "string" ? node.outerHTML : "";
      const text = markup === "" ? (node.textContent ?? "").trim() : markup;
      if (text !== "") blocks.push(text);
    }
    return blocks;
  });
}

export function splitTemplateBlocks(content: string, contentFormat: string): string[] {
  if (contentFormat === "html") return splitHtmlBlocks(content);
  return content
    .split(/\r?\n[ \t]*\r?\n/)
    .map((block) => block.trim())
    .filter((block) => block !== "");
}

// "removed" = only in the system template, "added" = only in the tenant version.
export function diffTemplateBlocks(
  system: readonly string[],
  tenant: readonly string[],
): TemplateDiffBlock[] {
  if (system.length * tenant.length > MAX_LCS_CELLS) {
    return [
      ...system.map((content) => ({ change: "removed" as const, content })),
      ...tenant.map((content) => ({ change: "added" as const, content })),
    ];
  }
  const rows = system.length;
  const cols = tenant.length;
  const width = cols + 1;
  // lengths[i * width + j] = LCS length of system[i..] and tenant[j..]
  const lengths = new Uint32Array((rows + 1) * width);
  const lengthAt = (i: number, j: number): number => lengths[i * width + j] ?? 0;
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      lengths[i * width + j] =
        system[i] === tenant[j]
          ? lengthAt(i + 1, j + 1) + 1
          : Math.max(lengthAt(i + 1, j), lengthAt(i, j + 1));
    }
  }
  const result: TemplateDiffBlock[] = [];
  let i = 0;
  let j = 0;
  while (i < rows || j < cols) {
    const systemBlock = system[i];
    const tenantBlock = tenant[j];
    if (systemBlock !== undefined && systemBlock === tenantBlock) {
      result.push({ change: "same", content: systemBlock });
      i++;
      j++;
    } else if (
      systemBlock !== undefined &&
      (tenantBlock === undefined || lengthAt(i + 1, j) >= lengthAt(i, j + 1))
    ) {
      result.push({ change: "removed", content: systemBlock });
      i++;
    } else if (tenantBlock !== undefined) {
      result.push({ change: "added", content: tenantBlock });
      j++;
    }
  }
  return result;
}
