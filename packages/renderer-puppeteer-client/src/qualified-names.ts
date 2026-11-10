// @runtime client
export const RENDERER_PUPPETEER_CLIENT_FEATURE = "renderer-puppeteer-client" as const;

export const RendererPuppeteerClientQueries = {
  status: "renderer-puppeteer-client:query:puppeteer-status",
  previewPdf: "renderer-puppeteer-client:query:preview-pdf",
  previewPng: "renderer-puppeteer-client:query:preview-png",
} as const;
