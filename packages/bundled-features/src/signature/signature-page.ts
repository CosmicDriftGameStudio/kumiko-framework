import { escapeHtmlAttr } from "@cosmicdrift/kumiko-renderer/headless";
import { SIGNATURE_METHOD, type SignatureMethod } from "./web/constants.ts";

export type SignaturePageLabels = {
  readonly heading: string;
  readonly documentHash: string;
  readonly signedAt: string;
  readonly inPerson: string;
  readonly link: string;
  readonly noRole: string;
};

export const DEFAULT_SIGNATURE_PAGE_LABELS: SignaturePageLabels = {
  heading: "Signature page",
  documentHash: "SHA-256 of the original document",
  signedAt: "Signed",
  inPerson: "In person",
  link: "By link",
  noRole: "",
};

export type SignaturePageEntry = {
  readonly name: string;
  readonly role: string | null;
  readonly signedAtIso: string;
  readonly method: SignatureMethod;
  readonly imagePng: Uint8Array;
};

function imageDataUri(png: Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
}

// Names and titles are free text typed by users; they reach Chromium as HTML, so every value is escaped.
function entryHtml(entry: SignaturePageEntry, labels: SignaturePageLabels): string {
  const way = entry.method === SIGNATURE_METHOD.InPerson ? labels.inPerson : labels.link;
  const role = entry.role === null ? labels.noRole : entry.role;
  return `<section class="entry">
  <img src="${escapeHtmlAttr(imageDataUri(entry.imagePng))}" alt="">
  <div class="meta">
    <strong>${escapeHtmlAttr(entry.name)}</strong>
    ${role === "" ? "" : `<span>${escapeHtmlAttr(role)}</span>`}
    <span>${escapeHtmlAttr(labels.signedAt)}: ${escapeHtmlAttr(entry.signedAtIso)} (${escapeHtmlAttr(way)})</span>
  </div>
</section>`;
}

export function buildSignaturePageHtml(args: {
  readonly title: string;
  readonly documentSha256: string;
  readonly entries: readonly SignaturePageEntry[];
  readonly labels: SignaturePageLabels;
}): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
body { font-family: sans-serif; font-size: 12px; color: #111; margin: 0; }
h1 { font-size: 20px; margin: 0 0 4px; }
h2 { font-size: 14px; font-weight: normal; margin: 0 0 24px; }
.entry { display: flex; align-items: center; gap: 24px; border-top: 1px solid #ccc; padding: 12px 0; page-break-inside: avoid; }
.entry img { width: 220px; height: 90px; object-fit: contain; }
.meta { display: flex; flex-direction: column; gap: 2px; }
.hash { margin-top: 24px; font-family: monospace; font-size: 10px; word-break: break-all; }
</style></head><body>
<h1>${escapeHtmlAttr(args.labels.heading)}</h1>
<h2>${escapeHtmlAttr(args.title)}</h2>
${args.entries.map((entry) => entryHtml(entry, args.labels)).join("\n")}
<p class="hash">${escapeHtmlAttr(args.labels.documentHash)}: ${escapeHtmlAttr(args.documentSha256)}</p>
</body></html>`;
}
