import {
  FileRefTooLargeError,
  FileStorageUnavailableError,
  readFileRefContent,
} from "@cosmicdrift/kumiko-bundled-features/file-foundation";
import type { RendererContext } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import {
  isResourceImageContentType,
  readTemplateResourceMaxBytes,
  toResourceDataUri,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { readBrandingLogo, readBrandingLogoUrl } from "./document-kit.ts";

// Pages a recipient opens have no cid attachments, so the uploaded logo travels inline. A
// logo that cannot be read or embedded falls back to the https address instead of failing
// the page.
export async function readChromeLogoSrc(ctx: RendererContext): Promise<string | undefined> {
  const fileRefId = await readBrandingLogo(ctx);
  if (fileRefId !== undefined && ctx.filesForTenant !== undefined) {
    try {
      const found = await readFileRefContent({
        db: ctx.db,
        filesForTenant: ctx.filesForTenant,
        fileRefId,
        allowedTenantIds: [ctx.tenantId],
        maxBytes: await readTemplateResourceMaxBytes(ctx.config, ctx.registry),
      });
      if (found !== null && isResourceImageContentType(found.contentType)) {
        return toResourceDataUri(found.contentType, found.content);
      }
    } catch (e) {
      if (!(e instanceof FileRefTooLargeError || e instanceof FileStorageUnavailableError)) {
        throw e;
      }
    }
  }
  return readBrandingLogoUrl(ctx);
}
