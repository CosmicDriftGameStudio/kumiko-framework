// Optional seeding helper for app authors. Writes DEFAULT_MAIL_LAYOUT_MJML
// as the system layout (tenantId=SYSTEM_TENANT_ID, slug="mail-layout") into the
// `template_resource` table.
//
// **When to use?** When the app author wants to make the default layout
// editable in the tenant admin UI (e.g. "here is your current mail layout, edit
// it"). Without seeding the plugin falls back to the in-code
// DEFAULT_MAIL_LAYOUT_MJML — functionally the same, but not editable UI-side.
//
// **When NOT to use?** When the app needs no UI customisation — the plugin
// renders with the hardcoded constant.
//
// Idempotent: a second call with the same (tenantId, slug, kind, locale)
// updates the existing row.
//
// Executor-direct (bypasses access checks), `by` is the framework
// system actor (createSystemUser) — deliberately NOT TestUsers like the
// bundled tenant/seeding.ts: test utilities do not belong in prod seeds.

import {
  templateResourceEntity,
  templateResourcesTable,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import {
  createEventStoreExecutor,
  createTenantDb,
  type DbConnection,
} from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { DEFAULT_MAIL_LAYOUT_MJML } from "./default-layout.js";

const LAYOUT_SLUG = "mail-layout";
const DEFAULT_LOCALE = "en";

const executor = createEventStoreExecutor(templateResourcesTable, templateResourceEntity, {
  entityName: "template-resource",
});

export type SeedSystemMailLayoutOptions = {
  /** Override MJML — if omitted, DEFAULT_MAIL_LAYOUT_MJML is used. */
  readonly mjml?: string;
  /** Locale for the layout row — default "en". */
  readonly locale?: string;
};

export async function seedSystemMailLayout(
  db: DbConnection,
  options: SeedSystemMailLayoutOptions = {},
): Promise<void> {
  const { mjml = DEFAULT_MAIL_LAYOUT_MJML, locale = DEFAULT_LOCALE } = options;
  // System templates live under SYSTEM_TENANT_ID. The stream bucket must match,
  // otherwise version_conflict on later upsertSystemTemplate calls.
  const by = createSystemUser(SYSTEM_TENANT_ID);
  const tdb = createTenantDb(db, SYSTEM_TENANT_ID, "system");
  // Pattern from text-content/seeding.ts: executor.create(payload, by, tdb).
  // tenantId must be in the payload (event-store stream bucket).
  const result = await executor.create(
    {
      tenantId: SYSTEM_TENANT_ID,
      slug: LAYOUT_SLUG,
      kind: "mail-html",
      locale,
      content: mjml,
      contentFormat: "mjml",
      variableSchema: "{}",
      linkedResources: "{}",
      scope: "system",
      status: "active",
    },
    by,
    tdb,
  );
  if (!result.isSuccess) {
    throw new Error(`seedSystemMailLayout: executor.create failed — ${JSON.stringify(result)}`);
  }
}
