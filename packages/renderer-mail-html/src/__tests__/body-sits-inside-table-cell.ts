// A body fragment emitted straight into a column's tbody is re-parented by mail
// clients into the font-size:0 wrapper and disappears; it must sit inside a <td>.
export function bodySitsInsideTableCell(html: string, body: string): boolean {
  const bodyStart = html.indexOf(body);
  if (bodyStart < 0) return false;
  const beforeBody = html.slice(0, bodyStart);
  return beforeBody.lastIndexOf("<td") > beforeBody.lastIndexOf("<tbody>");
}
