import type { RendererContext } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import {
  COMPANY_PLACEHOLDERS,
  companyConfigKey,
  readTenantConfigText,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";

// Every company placeholder is present, empty when the tenant set nothing, so a template
// that uses one never fails on a missing value.
export async function readCompanyData(ctx: RendererContext): Promise<Record<string, string>> {
  const entries = await Promise.all(
    COMPANY_PLACEHOLDERS.map(
      async (name) => [name, await readTenantConfigText(ctx, companyConfigKey(name))] as const,
    ),
  );
  return Object.fromEntries(entries);
}
