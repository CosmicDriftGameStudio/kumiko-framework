import {
  requireTemplateResolver,
  TEXT_BLOCK_KIND,
  type TemplateResolverApi,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { LEGAL_REQUIRED_BLOCKS, type LegalRequiredBlock } from "../constants.js";

// Only the fields the check reads, so HandlerContext, AppContext or a hand-built
// object in a unit test all fit.
export type LegalPagesBootCheckCtx = {
  readonly templateResolver?: TemplateResolverApi;
  readonly log?: {
    readonly info?: (msg: string) => void;
    readonly warn?: (msg: string) => void;
  };
};

// Missing required blocks fail the boot only in production; elsewhere they warn,
// so a dev setup without seeded legal texts still starts. A complete set logs
// info on purpose, so a skipped check is visible.
export async function runLegalPagesBootCheck(
  ctx: LegalPagesBootCheckCtx,
  requiredBlocks: readonly LegalRequiredBlock[] = LEGAL_REQUIRED_BLOCKS,
): Promise<void> {
  const templateResolver: TemplateResolverApi = requireTemplateResolver(
    ctx,
    "legal-pages-boot-check",
  );
  const missing: { slug: string; lang: string }[] = [];

  for (const required of requiredBlocks) {
    const block = await templateResolver.findExact({
      tenantId: SYSTEM_TENANT_ID,
      slug: required.slug,
      kind: TEXT_BLOCK_KIND,
      locale: required.lang,
    });
    if (!block?.content) {
      missing.push({ slug: required.slug, lang: required.lang });
    }
  }

  if (missing.length === 0) {
    ctx.log?.info?.("legal-pages boot-check: alle Pflicht-Blocks vorhanden");
  } else {
    const message =
      `legal-pages: missing ${missing.length} required text-block(s) in SYSTEM_TENANT: ` +
      missing.map((m) => `${m.slug}/${m.lang}`).join(", ") +
      ". Seed via template-resolver:write:set or the seedTextBlock helper.";

    if (process.env["NODE_ENV"] === "production") {
      throw new Error(`Boot-Validation failed: ${message}`);
    }
    ctx.log?.warn?.(message);
  }
}
