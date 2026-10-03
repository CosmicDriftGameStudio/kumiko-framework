import { escapeHtml, escapeHtmlAttr } from "@cosmicdrift/kumiko-headless";
import type { NotificationRenderer } from "../delivery/index.js";

export type MailBranding = {
  /** Shown as text when there is no logo, and as the logo alt text. */
  readonly productName?: string;
  /** Hex color (#rgb, #rrggbb, #rrggbbaa); used for buttons and the header accent. */
  readonly primaryColor?: string;
  /** Absolute http(s) URL; anything else is dropped. Mutually exclusive with `logoPath`. */
  readonly logoUrl?: string;
  /** Absolute path on `baseUrl` (e.g. "/logo.png"); use PNG/JPEG, mail clients block SVG. */
  readonly logoPath?: string;
  /** Absolute http(s) origin that `logoPath` is resolved against; same base as `auth.mail.baseUrl`. */
  readonly baseUrl?: string;
  /** Locale tried after the exact and language-part match when a localized field has no entry. */
  readonly defaultLocale?: string;
  readonly footerText?: LocalizedText;
  /** Absolute http(s) URLs only; string URLs that are not are dropped, localized ones fail at boot. */
  readonly footerLinks?: readonly {
    readonly label: LocalizedText;
    readonly url: LocalizedText;
  }[];
};

export type LocalizedText = string | Readonly<Record<string, string>>;

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

function languagePart(locale: string): string {
  return locale.split("-")[0] ?? locale;
}

function pickByLocale(
  entries: Readonly<Record<string, string>>,
  locale: string,
): string | undefined {
  // Own keys only: a locale like "constructor" must not hit Object.prototype.
  const ownEntry = (key: string): string | undefined =>
    Object.hasOwn(entries, key) ? entries[key] : undefined;
  return ownEntry(locale) ?? ownEntry(languagePart(locale));
}

function resolveLocalized(
  value: LocalizedText | undefined,
  locale: string | undefined,
  defaultLocale: string | undefined,
): string | undefined {
  if (value === undefined || typeof value === "string") return value;
  return (
    (locale !== undefined ? pickByLocale(value, locale) : undefined) ??
    (defaultLocale !== undefined ? pickByLocale(value, defaultLocale) : undefined) ??
    Object.values(value)[0]
  );
}

function assertLocalizedUrlsAreHttp(branding: MailBranding): void {
  for (const link of branding.footerLinks ?? []) {
    if (typeof link.url === "string") continue;
    for (const [locale, url] of Object.entries(link.url)) {
      if (!isHttpUrl(url)) {
        throw new Error(
          `createSimpleRenderer: footerLinks url for locale "${locale}" must be an absolute http(s) URL`,
        );
      }
    }
  }
}

function resolveLogoUrl(branding: MailBranding | undefined): string | undefined {
  if (!branding) return undefined;
  const { logoUrl, logoPath, baseUrl } = branding;
  if (logoPath === undefined) {
    return logoUrl && isHttpUrl(logoUrl) ? logoUrl : undefined;
  }
  if (logoUrl !== undefined) {
    throw new Error("createSimpleRenderer: logoPath and logoUrl are mutually exclusive");
  }
  if (baseUrl === undefined || !isHttpUrl(baseUrl)) {
    throw new Error("createSimpleRenderer: logoPath requires an absolute http(s) baseUrl");
  }
  if (!/^\/(?![/\\])/.test(logoPath) || logoPath.includes("\\")) {
    throw new Error('createSimpleRenderer: logoPath must start with a single "/"');
  }
  const resolved = new URL(logoPath, baseUrl);
  if (resolved.origin !== new URL(baseUrl).origin) {
    throw new Error("createSimpleRenderer: logoPath must stay on the baseUrl origin");
  }
  return resolved.href;
}

function resolvePrimaryColor(branding: MailBranding | undefined): string {
  const color = branding?.primaryColor;
  return color && HEX_COLOR_PATTERN.test(color) ? color : DEFAULT_PRIMARY_COLOR;
}

function renderBrandingHeader(
  branding: MailBranding | undefined,
  primaryColor: string,
  logoUrl: string | undefined,
): string {
  if (!branding) return "";
  if (!logoUrl && !branding.productName) return "";
  const logo = logoUrl
    ? `<img src="${escapeHtmlAttr(logoUrl)}" alt="${escapeHtmlAttr(branding.productName ?? "")}" style="display:block;max-height:40px;max-width:200px;border:0" />`
    : `<span style="font-size:18px;font-weight:700;color:${escapeHtmlAttr(primaryColor)}">${escapeHtml(branding.productName ?? "")}</span>`;
  return `<div style="margin:0 0 24px;padding:0 0 16px;border-bottom:3px solid ${escapeHtmlAttr(primaryColor)}">${logo}</div>`;
}

function renderBrandingFooter(
  branding: MailBranding | undefined,
  locale: string | undefined,
): string {
  if (!branding) return "";
  const pick = (value: LocalizedText | undefined): string | undefined =>
    resolveLocalized(value, locale, branding.defaultLocale);
  const links = (branding.footerLinks ?? []).flatMap((link) => {
    const url = pick(link.url);
    if (url === undefined || !isHttpUrl(url)) return [];
    return [
      `<a href="${escapeHtmlAttr(url)}" style="color:#999">${escapeHtml(pick(link.label) ?? "")}</a>`,
    ];
  });
  const footerText = pick(branding.footerText);
  const footerPartsHtml = [footerText ? escapeHtml(footerText) : "", links.join(" · ")].filter(
    (part) => part !== "",
  );
  if (footerPartsHtml.length === 0) return "";
  const footerHtml = footerPartsHtml.join("<br />");
  return `<p style="margin:16px 0 0;color:#999;font-size:12px">${footerHtml}</p>`;
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
    return `<p style="margin:0 0 16px"><a href="${escapeHtml(section.button.url)}" style="display:inline-block;padding:10px 24px;background:${escapeHtmlAttr(primaryColor)};color:#fff;text-decoration:none;border-radius:4px;font-size:14px">${escapeHtml(section.button.label)}</a></p>`;
  }
  return "";
}

// Simple Renderer: turns structured email template data into HTML with inline CSS.
// No external dependencies, no template engine — just string concatenation.
export function createSimpleRenderer(branding?: MailBranding): NotificationRenderer {
  const primaryColor = resolvePrimaryColor(branding);
  const logoUrl = resolveLogoUrl(branding);
  if (branding) assertLocalizedUrlsAreHttp(branding);
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
      parts.push(renderBrandingHeader(branding, primaryColor, logoUrl));

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

      parts.push(renderBrandingFooter(branding, input.locale));
      parts.push("</div></body></html>");
      return parts.join("");
    },
  };
}

export const simpleRenderer: NotificationRenderer = createSimpleRenderer();
