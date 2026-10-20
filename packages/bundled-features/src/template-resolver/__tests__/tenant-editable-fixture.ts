import type { TemplateKind } from "../constants.ts";
import type { TenantEditableTemplate } from "../template-edit-policy.ts";

export function tenantEditableTemplates(
  kinds: readonly TemplateKind[],
  slugs: readonly string[],
): TenantEditableTemplate[] {
  return kinds.flatMap((kind) =>
    slugs.map((slug) => ({ kind, slug, access: { roles: ["TenantAdmin"] } })),
  );
}
