// Optional seeding helper for app authors. Writes DEFAULT_MAIL_LAYOUT_MJML as the
// system layout (slug "default", kind "mail-layout", tenantId=SYSTEM_TENANT_ID)
// into the template-resource table.
//
// **When to use?** When the app author wants the default layout editable in the
// tenant admin UI. Without seeding the renderer falls back to the in-code
// DEFAULT_MAIL_LAYOUT_MJML, which renders identically but is not editable.
//
// Idempotent: a second call with unchanged content writes no event, a changed
// layout updates the existing row.

import { seedSystemTemplate } from "@cosmicdrift/kumiko-bundled-features/template-resolver/seeding";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { DEFAULT_MAIL_LAYOUT_MJML, DEFAULT_MAIL_LAYOUT_SLUG } from "./default-layout.ts";

const DEFAULT_LOCALE = "en";

export type SeedSystemMailLayoutOptions = {
  /** Override MJML — if omitted, DEFAULT_MAIL_LAYOUT_MJML is used. */
  readonly mjml?: string;
  /** Locale for the layout row — default "en". */
  readonly locale?: string;
  /** Layout slug — default "default". */
  readonly slug?: string;
};

export async function seedSystemMailLayout(
  db: DbConnection,
  options: SeedSystemMailLayoutOptions = {},
): Promise<void> {
  const {
    mjml = DEFAULT_MAIL_LAYOUT_MJML,
    locale = DEFAULT_LOCALE,
    slug = DEFAULT_MAIL_LAYOUT_SLUG,
  } = options;
  await seedSystemTemplate(db, {
    slug,
    kind: "mail-layout",
    locale,
    content: mjml,
    contentFormat: "mjml",
    meta: {},
    ifExists: "update",
  });
}
