import type { RendererContext } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import { escapeHtml, escapeHtmlAttr } from "@cosmicdrift/kumiko-headless";

export type MailFooterLink = { readonly label: string; readonly url: string };

export type MailFooter = {
  readonly text?: string;
  readonly imprint?: MailFooterLink;
  readonly privacy?: MailFooterLink;
};

export type MailFooterResolver = (input: {
  readonly locale: string;
  readonly ctx: RendererContext;
}) => MailFooter | null | Promise<MailFooter | null>;

const SAFE_FOOTER_URL = /^(https?:|mailto:)/i;
const BAND_LINK_COLOR = "#4A515E";

const UNSUBSCRIBE_LABEL_BY_LANGUAGE: Readonly<Record<string, string>> = {
  de: "Abmelden",
  en: "Unsubscribe",
  es: "Darse de baja",
};

function unsubscribeLabel(locale: string): string {
  const language = (locale.split("-")[0] ?? locale).toLowerCase();
  return UNSUBSCRIBE_LABEL_BY_LANGUAGE[language] ?? "Unsubscribe";
}

function linkHtml(link: MailFooterLink, color = "#888"): string | null {
  const url = link.url.trim();
  if (!SAFE_FOOTER_URL.test(url) || link.label.trim() === "") return null;
  return `<a href="${escapeHtmlAttr(url)}" style="color:${escapeHtmlAttr(color)}">${escapeHtml(link.label)}</a>`;
}

function webHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.host : null;
  } catch {
    return null;
  }
}

// The card's own footer line: the tenant's site and the unsubscribe link.
export function buildMailBandLinksHtml(input: {
  readonly siteUrl: string | undefined;
  readonly unsubscribeUrl: string;
  readonly locale: string;
  readonly layoutLinksUnsubscribe: boolean;
}): string {
  const host = input.siteUrl === undefined ? null : webHost(input.siteUrl);
  const links = [
    host === null || input.siteUrl === undefined
      ? null
      : linkHtml({ label: host, url: input.siteUrl }, BAND_LINK_COLOR),
    input.unsubscribeUrl === "" || input.layoutLinksUnsubscribe
      ? null
      : linkHtml(
          { label: unsubscribeLabel(input.locale), url: input.unsubscribeUrl },
          BAND_LINK_COLOR,
        ),
  ];
  return links.filter((link) => link !== null).join(" · ");
}

export function safeFooterUrl(link: MailFooterLink | undefined): string {
  return link !== undefined && SAFE_FOOTER_URL.test(link.url.trim()) ? link.url.trim() : "";
}

// Built in code with every value escaped, so it can go into the layout as raw
// HTML. Links the layout regions already carry are left out to avoid doubling them.
export function buildMailFooterHtml(input: {
  readonly footer: MailFooter | null;
  readonly unsubscribeUrl: string;
  readonly locale: string;
  readonly layoutLinksImprint: boolean;
  readonly layoutLinksUnsubscribe: boolean;
}): string {
  const { footer, unsubscribeUrl, locale } = input;
  const links: string[] = [];
  if (footer?.imprint !== undefined && !input.layoutLinksImprint) {
    const html = linkHtml(footer.imprint);
    if (html !== null) links.push(html);
  }
  if (footer?.privacy !== undefined) {
    const html = linkHtml(footer.privacy);
    if (html !== null) links.push(html);
  }
  if (unsubscribeUrl !== "" && !input.layoutLinksUnsubscribe) {
    const html = linkHtml({ label: unsubscribeLabel(locale), url: unsubscribeUrl });
    if (html !== null) links.push(html);
  }
  const text = footer?.text?.trim() ?? "";
  const lines = [
    ...(text === "" ? [] : [escapeHtml(text)]),
    ...(links.length === 0 ? [] : [links.join(" · ")]),
  ];
  return lines.join("<br>");
}

export function layoutLinksToPlaceholder(layoutHtml: string, name: string): boolean {
  return new RegExp(`href="\\{\\{\\s*${name}\\s*\\}\\}"`).test(layoutHtml);
}
