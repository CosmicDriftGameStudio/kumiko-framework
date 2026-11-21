const BLOCK_SELECTOR =
  "img, hr, a[data-button], div[data-page-break], div[data-steps], div[data-images]";

const CELL_BLOCK_SELECTOR = "p, li, div";

// Loose text next to blocks leads the cell; each innermost block follows as its own paragraph,
// so a div around a p does not emit its text twice.
function cellTexts(cell: HTMLTableCellElement): string[] {
  const blocks = [...cell.querySelectorAll(CELL_BLOCK_SELECTOR)].filter(
    (block) => block.querySelector(CELL_BLOCK_SELECTOR) === null,
  );
  const looseCell = cell.ownerDocument.createElement("div");
  looseCell.innerHTML = cell.innerHTML;
  for (const block of looseCell.querySelectorAll(CELL_BLOCK_SELECTOR)) block.remove();
  return [looseCell.textContent ?? "", ...blocks.map((block) => block.textContent ?? "")];
}

// A pasted table keeps its cell text as paragraphs, one per block in a cell; images, dividers and block nodes are dropped.
// Innermost tables go first, so a nested table's text lands in the outer cell as paragraphs and appears once.
export function textFormattingPasteHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  for (const block of parsed.body.querySelectorAll(BLOCK_SELECTOR)) block.remove();
  const tables = [...parsed.body.querySelectorAll("table")].reverse();
  for (const table of tables) {
    const texts = [...table.rows].flatMap((row) => [...row.cells].flatMap(cellTexts));
    const paragraphs = texts
      .map((text) => text.trim())
      .filter((text) => text !== "")
      .map((text) => {
        const paragraph = parsed.createElement("p");
        paragraph.textContent = text;
        return paragraph;
      });
    table.replaceWith(...paragraphs);
  }
  return parsed.body.innerHTML;
}
