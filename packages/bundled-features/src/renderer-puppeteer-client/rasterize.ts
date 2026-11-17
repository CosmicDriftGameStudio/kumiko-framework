// Client for puppeteer-service /rasterize: PDF bytes in, PNG pages (and embedded images) out.

import { RendererError } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import * as z from "zod";
import { postRasterize } from "./http-client.ts";
import { loadClientConfigOrUnavailable } from "./render.ts";

// The result key the agent runtime reads to show images to the model; the enterprise ai-agent
// depends on this exact name.
export const AGENT_IMAGES_RESULT_KEY = "agentImages";

const rasterImageSchema = z.object({
  mimeType: z.literal("image/png"),
  data: z.string().min(1),
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
});

export const rasterizeResponseSchema = z.object({
  pages: z.array(rasterImageSchema),
  images: z.array(rasterImageSchema),
});

export type RasterImage = z.infer<typeof rasterImageSchema>;
export type RasterizedPdf = z.infer<typeof rasterizeResponseSchema>;

export type RasterizeOptions = {
  readonly maxPages?: number;
  readonly dpi?: 72 | 100 | 150;
  /** Also return the images embedded in the PDF. */
  readonly images?: boolean;
};

export async function rasterizePdf(
  bytes: Uint8Array,
  options: RasterizeOptions = {},
): Promise<RasterizedPdf> {
  const raw = await postRasterize(loadClientConfigOrUnavailable(), {
    pdfBase64: Buffer.from(bytes).toString("base64"),
    ...options,
  });
  const parsed = rasterizeResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new RendererError(
      `puppeteer-service returned an unexpected /rasterize response: ${parsed.error.message}`,
      "other",
    );
  }
  return parsed.data;
}
