import { escapeHtml, escapeHtmlAttr } from "@cosmicdrift/kumiko-renderer/headless";

const SLOT_PATTERN = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

// Author text uses `{name}` slots. The text is escaped first and the slots are
// swapped for variable nodes afterwards, so a slot can never smuggle markup.
export function mailTextWithSlotsHtml(text: string): string {
  return escapeHtml(text).replace(
    SLOT_PATTERN,
    (_, name: string) => `<span data-variable="${escapeHtmlAttr(name)}"></span>`,
  );
}

type MailParagraphOptions = { readonly showIf?: string };

function paragraphOpenTag(options: MailParagraphOptions | undefined): string {
  return options?.showIf === undefined ? "<p>" : `<p data-if="${escapeHtmlAttr(options.showIf)}">`;
}

export function mailParagraph(text: string, options?: MailParagraphOptions): string {
  return `${paragraphOpenTag(options)}${mailTextWithSlotsHtml(text)}</p>`;
}

export function mailHeading(text: string): string {
  return `<h2>${mailTextWithSlotsHtml(text)}</h2>`;
}

export function mailButton(label: string, linkVariable: string): string {
  return `<p><a data-button href="{{${escapeHtmlAttr(linkVariable)}}}">${escapeHtml(label)}</a></p>`;
}

export function mailParagraphWithLink(
  text: string,
  linkLabel: string,
  linkVariable: string,
  options?: MailParagraphOptions,
): string {
  return `${paragraphOpenTag(options)}${mailTextWithSlotsHtml(text)} <a href="{{${escapeHtmlAttr(linkVariable)}}}">${escapeHtml(linkLabel)}</a></p>`;
}

// One table row per list entry; the cell shows the entry's `field`.
export function mailRepeatedRows(listName: string, field: string): string {
  return `<table><tbody><tr data-each="${escapeHtmlAttr(listName)}"><td><p><span data-variable="${escapeHtmlAttr(field)}"></span></p></td></tr></tbody></table>`;
}

// Subjects are Handlebars text, so the same `{name}` slots become `{{name}}`.
export function mailSubject(text: string): string {
  return text.replace(SLOT_PATTERN, "{{$1}}");
}
