import type { Registry } from "@cosmicdrift/kumiko-framework/engine";
import { isSystemAdmin } from "./template-draft.js";

const NOTIFICATION_TEMPLATE_KIND = "mail";

// A notification registered with systemOnly keeps its mail template as the system default:
// tenants neither list nor override it, and overrides stored before the flag are ignored.
export function isSystemOnlyTemplate(registry: Registry, slug: string, kind: string): boolean {
  return (
    kind === NOTIFICATION_TEMPLATE_KIND &&
    registry.getAllNotifications().get(slug)?.systemOnly === true
  );
}

export function isSystemOnlyTemplateHiddenFrom(
  user: { readonly roles: readonly string[] },
  registry: Registry,
  row: { readonly slug: string; readonly kind: string },
): boolean {
  return !isSystemAdmin(user) && isSystemOnlyTemplate(registry, row.slug, row.kind);
}
