import { createSignatureFeature } from "@cosmicdrift/kumiko-bundled-features/signature";
import { PDFDocument } from "pdf-lib";

// In an app `deliverLink` sends a mail to the signer. The recipe keeps the links in a map so the
// test can open them: the link is never part of a handler result.
export const deliveredLinks = new Map<string, string>();

// In an app this is `renderHtmlToPdf` from @cosmicdrift/kumiko-renderer-puppeteer-client, which
// needs the print service; the recipe prints a blank page instead.
async function printSignaturePage(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  return pdf.save();
}

export const SIGNATURE_LINK_SECRET = "signature-recipe-link-secret-0123456789";

export const signatureFeature = createSignatureFeature({
  retention: { keepFor: "10y" },
  linkSecret: SIGNATURE_LINK_SECRET,
  renderHtmlToPdf: printSignaturePage,
  signaturePageUrl: "https://app.example/sign",
  deliverLink: async (_ctx, { signerId, url }) => {
    deliveredLinks.set(signerId, url);
  },
});
