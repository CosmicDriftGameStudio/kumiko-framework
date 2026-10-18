import { createHash } from "node:crypto";
import { mailT } from "@cosmicdrift/kumiko-framework/i18n";
import { escapeHtml, escapeHtmlAttr } from "@cosmicdrift/kumiko-headless";
import type { MailChrome, MailChromeLink } from "../renderer-foundation/index.ts";
import { DELIVERY_RESUBSCRIBE_PATH, DELIVERY_UNSUBSCRIBE_PATH } from "./public-names.ts";
import "./unsubscribe-page-strings.ts";

export type UnsubscribePageState =
  | { readonly kind: "confirm"; readonly token: string }
  // Without a resubscribeToken the page offers no undo button.
  | { readonly kind: "unsubscribed"; readonly resubscribeToken?: string }
  | { readonly kind: "resubscribed" }
  | { readonly kind: "failed" }
  | { readonly kind: "invalid" };

export type UnsubscribePageInput = {
  readonly state: UnsubscribePageState;
  /** A locale with registered mail translations (see resolveMailLocale). */
  readonly locale: string;
  /** The tenant's mail look; without it the page shows the plain card. */
  readonly chrome?: MailChrome | null | undefined;
};

// Same values as the in-code mail layout of renderer-mail-html, so the page reads as the mail's sequel.
const DEFAULT_ACCENT_COLOR = "#1f5468";
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const FONT_URL_PREFIX = "/assets/kumiko/fonts/ibm-plex-sans-latin-";

function accentOf(chrome: MailChrome | null | undefined): string {
  const accent = chrome?.accentColor;
  return accent !== undefined && HEX_COLOR.test(accent) ? accent : DEFAULT_ACCENT_COLOR;
}

function httpsOrigin(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.origin : undefined;
  } catch {
    return undefined;
  }
}

function webHost(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.host : undefined;
  } catch {
    return undefined;
  }
}

const SAFE_LINK_URL = /^(https?:|mailto:)/i;

function linkHtml(link: MailChromeLink): string {
  const url = link.url.trim();
  if (!SAFE_LINK_URL.test(url) || link.label.trim() === "") return "";
  return `<a href="${escapeHtmlAttr(url)}">${escapeHtml(link.label)}</a>`;
}

// The style block is static apart from the validated hex accent and the markup carries
// no style attributes, so the CSP admits exactly this block by its hash.
function pageStyle(accent: string): string {
  return `@font-face{font-family:"IBM Plex Sans";font-style:normal;font-weight:400;font-display:swap;src:url("${FONT_URL_PREFIX}400.woff2") format("woff2")}
@font-face{font-family:"IBM Plex Sans";font-style:normal;font-weight:600;font-display:swap;src:url("${FONT_URL_PREFIX}600.woff2") format("woff2")}
:root{--accent:${accent}}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:#ecedea;color:#2a2f3a;font-family:"IBM Plex Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;-webkit-font-smoothing:antialiased}
.page{max-width:560px;margin:0 auto;padding:48px 16px}
.card{background:#fff;border:1px solid #dcdfda;border-radius:14px;overflow:hidden}
.accent{height:4px;background:var(--accent)}
.brand{display:flex;align-items:center;gap:10px;padding:32px 40px 0}
.brand img{height:28px;width:auto;max-width:140px;display:block}
.tile{width:28px;height:28px;line-height:28px;border-radius:8px;background:var(--accent);color:#fff;font-weight:600;font-size:14px;text-align:center;flex:none}
.name{font-size:15px;font-weight:600;color:#0b0d12}
.suffix{font-size:13px;color:#5a6170}
.content{padding:28px 40px 36px}
h1{margin:0 0 8px;font-size:22px;line-height:1.3;font-weight:600;color:#0b0d12}
p{margin:0}
form{margin:24px 0 0}
.button{display:inline-block;font:inherit;font-weight:600;font-size:15px;line-height:1.4;padding:10px 20px;border-radius:6px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer}
.button.secondary{background:#fff;color:var(--accent)}
.button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.hint{margin-top:24px;font-size:14px;color:#5a6170}
.hint+form{margin-top:12px}
.band{background:#fbfbfa;border-top:1px solid #ecedea;padding:16px 40px;font-size:13px;color:#5a6170}
.band a{color:#4a515e}
.footer{padding:20px 24px 0;text-align:center;font-size:12px;color:#5a6170}
.footer a{color:#5a6170}
@media (max-width:480px){.page{padding:24px 12px}.brand{padding:24px 20px 0}.content{padding:20px 20px 28px}.band{padding:14px 20px}h1{font-size:20px}.button{width:100%}}`;
}

function brandRowHtml(chrome: MailChrome): string {
  const name = chrome.tenantName.trim();
  const initial = Array.from(name)[0]?.toLocaleUpperCase() ?? "";
  const mark =
    httpsOrigin(chrome.logoUrl) !== undefined && chrome.logoUrl !== undefined
      ? `<img src="${escapeHtmlAttr(chrome.logoUrl)}" alt="">`
      : initial === ""
        ? ""
        : `<span class="tile" aria-hidden="true">${escapeHtml(initial)}</span>`;
  const suffix = chrome.brandSuffix.trim();
  if (mark === "" && name === "") return "";
  return `<div class="brand">${mark}${name === "" ? "" : `<span class="name">${escapeHtml(name)}</span>`}${suffix === "" ? "" : `<span class="suffix">${escapeHtml(suffix)}</span>`}</div>`;
}

function bandHtml(chrome: MailChrome): string {
  const host = chrome.siteUrl === undefined ? undefined : webHost(chrome.siteUrl);
  if (host === undefined || chrome.siteUrl === undefined) return "";
  return `<div class="band"><a href="${escapeHtmlAttr(chrome.siteUrl)}">${escapeHtml(host)}</a></div>`;
}

function footerHtml(chrome: MailChrome): string {
  const text = chrome.footerText?.trim() ?? "";
  const links = [chrome.imprint, chrome.privacy]
    .map((link) => (link === undefined ? "" : linkHtml(link)))
    .filter((html) => html !== "");
  const lineHtmls = [
    ...(text === "" ? [] : [escapeHtml(text)]),
    ...(links.length === 0 ? [] : [links.join(" · ")]),
  ];
  const linesHtml = lineHtmls.join("<br>");
  return linesHtml === "" ? "" : `<footer class="footer">${linesHtml}</footer>`;
}

function tokenForm(action: string, token: string, label: string, variant: string): string {
  return `<form method="post" action="${escapeHtmlAttr(action)}">
<input type="hidden" name="token" value="${escapeHtmlAttr(token)}">
<button type="submit" class="${escapeHtmlAttr(variant)}">${escapeHtml(label)}</button>
</form>`;
}

type PageText = { readonly title: string; readonly bodyHtml: string };

function pageText(state: UnsubscribePageState, lang: string): PageText {
  const paragraph = (key: string): string => `<p>${escapeHtml(mailT(lang, key))}</p>`;
  switch (state.kind) {
    case "confirm":
      return {
        title: mailT(lang, "mail.unsubscribe.confirmTitle"),
        bodyHtml: `${paragraph("mail.unsubscribe.confirmQuestion")}
${tokenForm(DELIVERY_UNSUBSCRIBE_PATH, state.token, mailT(lang, "mail.unsubscribe.confirmButton"), "button")}`,
      };
    case "unsubscribed":
      return {
        title: mailT(lang, "mail.unsubscribe.doneTitle"),
        bodyHtml:
          state.resubscribeToken === undefined
            ? paragraph("mail.unsubscribe.doneMessage")
            : `${paragraph("mail.unsubscribe.doneMessage")}
<p class="hint">${escapeHtml(mailT(lang, "mail.unsubscribe.undoHint"))}</p>
${tokenForm(DELIVERY_RESUBSCRIBE_PATH, state.resubscribeToken, mailT(lang, "mail.unsubscribe.undoButton"), "button secondary")}`,
      };
    case "resubscribed":
      return {
        title: mailT(lang, "mail.unsubscribe.resubscribedTitle"),
        bodyHtml: paragraph("mail.unsubscribe.resubscribedMessage"),
      };
    case "failed":
      return {
        title: mailT(lang, "mail.unsubscribe.failedTitle"),
        bodyHtml: paragraph("mail.unsubscribe.failed"),
      };
    case "invalid":
      return {
        title: mailT(lang, "mail.unsubscribe.invalidTitle"),
        bodyHtml: paragraph("mail.unsubscribe.invalidMessage"),
      };
  }
}

export type RenderedUnsubscribePage = {
  readonly html: string;
  readonly contentSecurityPolicy: string;
};

// The page loads nothing but its own style block, the same-origin font and, with
// branding, the tenant's https logo. Forms only post back to the same origin.
function contentSecurityPolicy(style: string, chrome: MailChrome | null | undefined): string {
  const styleHash = createHash("sha256").update(style).digest("base64");
  const logoOrigin = httpsOrigin(chrome?.logoUrl);
  return [
    "default-src 'none'",
    `style-src 'sha256-${styleHash}'`,
    "font-src 'self'",
    `img-src 'self' data:${logoOrigin === undefined ? "" : ` ${logoOrigin}`}`,
    "form-action 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function renderUnsubscribePage(input: UnsubscribePageInput): RenderedUnsubscribePage {
  const { state, locale, chrome } = input;
  const { title, bodyHtml } = pageText(state, locale);
  const style = pageStyle(accentOf(chrome));
  const branded = chrome !== null && chrome !== undefined;
  // html-ok: static CSS whose only variable is the hex-validated accent; escaping would break its quotes and the CSP hash.
  const styleBlockHtml = `<style>${style}</style>`;
  const html = `<!doctype html>
<html lang="${escapeHtmlAttr(locale)}">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${styleBlockHtml}
</head>
<body>
<main class="page">
<div class="card">
<div class="accent"></div>
${branded ? brandRowHtml(chrome) : ""}
<div class="content">
<h1>${escapeHtml(title)}</h1>
${bodyHtml}
</div>
${branded ? bandHtml(chrome) : ""}
</div>
${branded ? footerHtml(chrome) : ""}
</main>
</body>
</html>`;
  return { html, contentSecurityPolicy: contentSecurityPolicy(style, chrome) };
}
