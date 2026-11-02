import { substituteVariables } from "@cosmicdrift/kumiko-renderer";

// Replaces the variable chips of an editor document with their example values, so a preview shows
// the finished text. Works on a parsed DOM and inserts values as text nodes: markup characters in a
// value end up escaped in the serialized HTML. A placeholder without an example value stays
// visible by its name.
export function fillDocumentVariables(
  html: string,
  examples: Readonly<Record<string, string>>,
): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const chip of Array.from(doc.body.querySelectorAll("[data-variable]"))) {
    const name = chip.getAttribute("data-variable") ?? "";
    chip.replaceWith(doc.createTextNode(examples[name] ?? `{{${name}}}`));
  }
  // Placeholders typed as literal `{{name}}` text (older entries) fill the same way.
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node instanceof Text) textNodes.push(node);
  }
  for (const node of textNodes) node.data = substituteVariables(node.data, examples);
  return doc.body.innerHTML;
}
