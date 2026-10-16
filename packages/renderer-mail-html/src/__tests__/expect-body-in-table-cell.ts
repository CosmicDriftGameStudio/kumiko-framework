import { expect } from "bun:test";

// A body fragment emitted straight into a column's tbody is re-parented by mail
// clients into the font-size:0 wrapper and disappears; it must sit inside a <td>.
export function expectBodyInsideTableCell(html: string, body: string): void {
  expect(html).toContain(body);
  const beforeBody = html.slice(0, html.indexOf(body));
  expect(beforeBody.lastIndexOf("<td")).toBeGreaterThan(beforeBody.lastIndexOf("<tbody>"));
}
