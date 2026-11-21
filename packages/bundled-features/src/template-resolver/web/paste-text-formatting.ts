const BLOCK_SELECTOR =
  "img, hr, a[data-button], div[data-page-break], div[data-steps], div[data-images]";

// A pasted table keeps its cell text as paragraphs; images, dividers and block nodes are dropped.
export function textFormattingPasteHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  for (const block of parsed.body.querySelectorAll(BLOCK_SELECTOR)) block.remove();
  for (const table of parsed.body.querySelectorAll("table")) {
    const paragraphs = [...table.querySelectorAll("td, th")].flatMap((cell) => {
      const text = cell.textContent?.trim() ?? "";
      if (text === "") return [];
      const paragraph = parsed.createElement("p");
      paragraph.textContent = text;
      return [paragraph];
    });
    table.replaceWith(...paragraphs);
  }
  return parsed.body.innerHTML;
}
