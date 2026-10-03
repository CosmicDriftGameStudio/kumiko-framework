import { escapeHtml, escapeHtmlAttr } from "@cosmicdrift/kumiko-headless";
import type { NotificationRenderer } from "../delivery/index.js";

export type MailBranding = {
  /** Shown as text when there is no logo, and as the logo alt text. */
  readonly productName?: string;
  /** Hex color (#rgb, #rrggbb, #rrggbbaa); used for buttons and the header accent. */
  readonly primaryColor?: string;
  /** Absolute http(s) URL; anything else is dropped. */
  readonly logoUrl?: string;
  readonly footerText?: string;
  /** Absolute http(s) URLs only; other entries are dropped. */
  readonly footerLinks?: readonly { readonly label: string; readonly url: string }[];
};

const DEFAULT_PRIMARY_COLOR = "#2563eb";
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function resolvePrimaryColor(branding: MailBranding | undefined): string {
  const color = branding?.primaryColor;
  return color && HEX_COLOR_PATTERN.test(color) ? color : DEFAULT_PRIMARY_COLOR;
}

function renderBrandingHeader(branding: MailBranding | undefined, primaryColor: string): string {
  if (!branding) return "";
  const logoUrl = branding.logoUrl && isHttpUrl(branding.logoUrl) ? branding.logoUrl : undefined;
  if (!logoUrl && !branding.productName) return "";
  const logo = logoUrl
    ? `<img src="${escapeHtmlAttr(logoUrl)}" alt="${escapeHtmlAttr(branding.productName ?? "")}" style="display:block;max-height:40px;max-width:200px;border:0" />`
    : `<span style="font-size:18px;font-weight:700;color:${primaryColor}">${escapeHtml(branding.productName ?? "")}</span>`;
  return `<div style="margin:0 0 24px;padding:0 0 16px;border-bottom:3px solid ${primaryColor}">${logo}</div>`;
}

function renderBrandingFooter(branding: MailBranding | undefined): string {
  if (!branding) return "";
  const links = (branding.footerLinks ?? [])
    .filter((link) => isHttpUrl(link.url))
    .map(
      (link) =>
        `<a href="${escapeHtmlAttr(link.url)}" style="color:#999">${escapeHtml(link.label)}</a>`,
    );
  const parts = [
    branding.footerText ? escapeHtml(branding.footerText) : "",
    links.join(" · "),
  ].filter((part) => part !== "");
  if (parts.length === 0) return "";
  return `<p style="margin:16px 0 0;color:#999;font-size:12px">${parts.join("<br />")}</p>`;
}

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

function renderSection(section: Section, primaryColor: string): string {
  if ("text" in section) {
    return `<p style="margin:0 0 16px;color:#333;font-size:14px;line-height:1.5">${escapeHtml(section.text)}</p>`;
  }
  if ("button" in section) {
    return `<p style="margin:0 0 16px"><a href="${escapeHtml(section.button.url)}" style="display:inline-block;padding:10px 24px;background:${primaryColor};color:#fff;text-decoration:none;border-radius:4px;font-size:14px">${escapeHtml(section.button.label)}</a></p>`;
  }
  return "";
}

// Simple Renderer: turns structured email template data into HTML with inline CSS.
// No external dependencies, no template engine — just string concatenation.
export function createSimpleRenderer(branding?: MailBranding): NotificationRenderer {
  const primaryColor = resolvePrimaryColor(branding);
  return {
    name: "simple",

    async render(input) {
      const data = input.variables as EmailTemplateData; // @cast-boundary render-helper

      // Fallback: if no structured fields, use title + body as header + single text section
      const header = data.header ?? data.title;
      const sections = data.sections ?? (data.body ? [{ text: data.body }] : undefined);

      const parts: string[] = [];
      parts.push('<!DOCTYPE html><html><body style="margin:0;padding:0;font-family:sans-serif">');
      parts.push('<div style="max-width:600px;margin:0 auto;padding:24px">');
      parts.push(renderBrandingHeader(branding, primaryColor));

      if (header) {
        parts.push(
          `<h1 style="margin:0 0 24px;color:#111;font-size:20px;font-weight:600">${escapeHtml(header)}</h1>`,
        );
      }

      if (sections) {
        for (const section of sections) {
          parts.push(renderSection(section, primaryColor));
        }
      }

      if (data.footer) {
        parts.push(
          `<p style="margin:24px 0 0;color:#999;font-size:12px;border-top:1px solid #eee;padding-top:16px">${escapeHtml(data.footer)}</p>`,
        );
      }

      parts.push(renderBrandingFooter(branding));
      parts.push("</div></body></html>");
      return parts.join("");
    },
  };
}

export const simpleRenderer: NotificationRenderer = createSimpleRenderer();
