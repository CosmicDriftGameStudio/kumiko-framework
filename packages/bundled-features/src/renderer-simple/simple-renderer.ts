import { escapeHtml } from "@cosmicdrift/kumiko-headless";
import type { NotificationRenderer } from "../delivery";

type Section =
  | { readonly text: string }
  | { readonly button: { readonly label: string; readonly url: string } };

type EmailTemplateData = {
  // Preferred: structured email data
  readonly header?: string;
  readonly sections?: readonly Section[];
  readonly footer?: string;
  // Fallback: plain title + body (used when no structured template is defined)
  readonly title?: string;
  readonly body?: string;
};

function renderSection(section: Section): string {
  if ("text" in section) {
    return `<p style="margin:0 0 16px;color:#333;font-size:14px;line-height:1.5">${escapeHtml(section.text)}</p>`;
  }
  if ("button" in section) {
    return `<p style="margin:0 0 16px"><a href="${escapeHtml(section.button.url)}" style="display:inline-block;padding:10px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:4px;font-size:14px">${escapeHtml(section.button.label)}</a></p>`;
  }
  return "";
}

// Simple Renderer: turns structured email template data into HTML with inline CSS.
// No external dependencies, no template engine — just string concatenation.
export const simpleRenderer: NotificationRenderer = {
  name: "simple",

  async render(input) {
    const data = input.variables as EmailTemplateData; // @cast-boundary render-helper

    // Fallback: if no structured fields, use title + body as header + single text section
    const header = data.header ?? data.title;
    const sections = data.sections ?? (data.body ? [{ text: data.body }] : undefined);

    const parts: string[] = [];
    parts.push('<!DOCTYPE html><html><body style="margin:0;padding:0;font-family:sans-serif">');
    parts.push('<div style="max-width:600px;margin:0 auto;padding:24px">');

    if (header) {
      parts.push(
        `<h1 style="margin:0 0 24px;color:#111;font-size:20px;font-weight:600">${escapeHtml(header)}</h1>`,
      );
    }

    if (sections) {
      for (const section of sections) {
        parts.push(renderSection(section));
      }
    }

    if (data.footer) {
      parts.push(
        `<p style="margin:24px 0 0;color:#999;font-size:12px;border-top:1px solid #eee;padding-top:16px">${escapeHtml(data.footer)}</p>`,
      );
    }

    parts.push("</div></body></html>");
    return parts.join("");
  },
};
