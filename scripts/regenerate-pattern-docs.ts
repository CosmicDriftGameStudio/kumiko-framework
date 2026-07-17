#!/usr/bin/env bun
// @runtime tooling
// regenerate-pattern-docs — generiert die Pattern-Reference-Pages unter
// `platform/apps/docs/src/content/docs/{de,en}/patterns/<kind>.mdx`
// aus einer Inline-Datendefinition. Spiegelt die in `docs-strategy.md`
// skizzierte "Custom-Generator (ts-morph)"-Idee, bleibt aber ohne
// ts-morph-Abhängigkeit — die Liste hier wird per Hand gepflegt parallel
// zu `packages/framework/src/engine/feature-ast/patterns.ts`. Wer einen
// neuen Pattern-Kind in patterns.ts ergänzt, ergänzt das Doc hier im
// selben PR; sonst rutscht der Pattern-Type ins Doc-Stub-Loch.
//
// **Warum dieses Script im Hauptrepo lebt** und nicht im Docs-Repo: die
// Quelle (patterns.ts) lebt hier, die Pflege erfolgt vom selben
// Entwickler im selben Mental-Model. Output landet via
// `platform/`-Symlink im Docs-Repo (`kumiko-platform`), git zeigt den
// Diff dort an — also zwei Commits pro Update (einer pro Repo).
//
// Aufruf: `bun run scripts/regenerate-pattern-docs.ts`
//
// Smoke-Validation am Ende: alle `/de/patterns/<x>/`- und
// `/en/patterns/<x>/`-URLs aus den Bodies werden gegen die wirklich
// geschriebenen Files geprüft. Bei Drift exit 1 — schützt gegen
// Casing-Bugs (Starlight slugifiziert auf lowercase) und Tippfehler.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

type Editability = "static" | "mixed" | "opaque";

type PatternDoc = {
  readonly kind: string;
  readonly tsType: string;
  readonly editability: Editability;
  readonly de: { readonly description: string; readonly body: string };
  readonly en: { readonly description: string; readonly body: string };
};

const PATTERNS: readonly PatternDoc[] = [
  {
    kind: "entity",
    tsType: "EntityPattern",
    editability: "static",
    de: {
      description: "Entity-Definition — Felder, Validation, Tabelle, Form, Liste in einem.",
      body: `Registriert eine Entity. Aus einer einzigen Definition leitet das Framework Drizzle-Tabelle, Zod-Schema und ViewModel für Form/Liste ab.

\`\`\`typescript
r.entity("note", createEntity({
  fields: {
    title: createTextField({ required: true, sortable: true }),
    pinned: createBooleanField({ default: false }),
  },
}));
\`\`\`

**Siehe auch:** [Walkthrough](/de/walkthrough/) · [Schema-System](/de/framework/#schema-system) · Recipe [\`basic-entity\`](/de/samples/recipes/basic-entity/)`,
    },
    en: {
      description: "Entity definition — fields, validation, table, form, list in one.",
      body: `Registers an entity. From a single definition the framework derives the Drizzle table, the Zod schema and the form/list view-model.

\`\`\`typescript
r.entity("note", createEntity({
  fields: {
    title: createTextField({ required: true, sortable: true }),
    pinned: createBooleanField({ default: false }),
  },
}));
\`\`\`

**See also:** [Walkthrough](/en/walkthrough/) · [Schema system](/en/framework/#schema-system) · Recipe [\`basic-entity\`](/en/samples/recipes/basic-entity/)`,
    },
  },
  {
    kind: "relation",
    tsType: "RelationPattern",
    editability: "static",
    de: {
      description: "Beziehung zwischen zwei Entities — Cascade, Restrict, Reverse-Lookup, Indices.",
      body: `Erklärt eine Parent-/Child-Relation. Setzt automatisch Foreign-Key + Index, beeinflusst Delete-Verhalten (Cascade vs. Restrict) und macht den Reverse-Lookup typisiert.

\`\`\`typescript
r.relation({
  entity: "comment",
  field: "postId",
  references: "post",
  onDelete: "cascade",
});
\`\`\`

**Siehe auch:** Recipe [\`relations\`](/de/samples/recipes/relations/)`,
    },
    en: {
      description: "Relation between two entities — cascade, restrict, reverse lookup, indices.",
      body: `Declares a parent/child relation. Auto-creates the foreign key + index, drives delete behaviour (cascade vs. restrict) and makes the reverse lookup typed.

\`\`\`typescript
r.relation({
  entity: "comment",
  field: "postId",
  references: "post",
  onDelete: "cascade",
});
\`\`\`

**See also:** Recipe [\`relations\`](/en/samples/recipes/relations/)`,
    },
  },
  {
    kind: "nav",
    tsType: "NavPattern",
    editability: "static",
    de: {
      description: "Navigations-Eintrag — Sidebar-Item mit i18n-Label, Icon, Order, Parent-Hierarchie.",
      body: `Hängt einen Eintrag in die App-Sidebar. Label-Key folgt der i18n-Konvention \`<feature>:nav.<id>\`. Cross-Feature-Parents sind erlaubt (z. B. Admin-Pages aller Features unter einem gemeinsamen "Admin").

\`\`\`typescript
r.nav({
  id: "notes",
  label: "notes:nav.list",
  order: 10,
  screen: "note-list",
});
\`\`\`

**Siehe auch:** Recipe [\`screens-nav\`](/de/samples/recipes/screens-nav/)`,
    },
    en: {
      description: "Navigation entry — sidebar item with i18n label, icon, order, parent hierarchy.",
      body: `Adds an entry to the app sidebar. Label key follows the i18n convention \`<feature>:nav.<id>\`. Cross-feature parents are allowed (e.g. admin pages of all features under a shared "Admin").

\`\`\`typescript
r.nav({
  id: "notes",
  label: "notes:nav.list",
  order: 10,
  screen: "note-list",
});
\`\`\`

**See also:** Recipe [\`screens-nav\`](/en/samples/recipes/screens-nav/)`,
    },
  },
  {
    kind: "workspace",
    tsType: "WorkspacePattern",
    editability: "static",
    de: {
      description: "Workspace-Definition — Persona-/Rolle-gegateter Bereich mit eigener Sidebar.",
      body: `Deklariert einen Workspace für die \`WorkspaceShell\`. Mehrere Personas (Admin, Dispatcher, Driver) leben in einer App, jeder mit eigener Sidebar + Default-Screen, gegated durch Roles oder Custom-Predicate.

\`\`\`typescript
r.workspace({
  id: "dispatch",
  label: "dispatch:workspace.title",
  roles: ["Dispatcher", "Admin"],
  defaultScreen: "tour-list",
});
\`\`\`

**Siehe auch:** Sample [\`apps/workspaces\`](/de/samples/apps/workspaces/)`,
    },
    en: {
      description: "Workspace definition — persona/role-gated area with its own sidebar.",
      body: `Declares a workspace for the \`WorkspaceShell\`. Multiple personas (admin, dispatcher, driver) live in one app, each with its own sidebar + default screen, gated by roles or a custom predicate.

\`\`\`typescript
r.workspace({
  id: "dispatch",
  label: "dispatch:workspace.title",
  roles: ["Dispatcher", "Admin"],
  defaultScreen: "tour-list",
});
\`\`\`

**See also:** Sample [\`apps/workspaces\`](/en/samples/apps/workspaces/)`,
    },
  },
  {
    kind: "config",
    tsType: "ConfigPattern",
    editability: "static",
    de: {
      description: "Typed Config-Key — Plattform-Default + Tenant-/User-Override, optional encrypted.",
      body: `Deklariert einen Config-Key, den Operator/Tenant pro Scope überschreiben können. Mit \`encrypted: true\` wird der Wert per Master-Key encrypted abgelegt.

\`\`\`typescript
r.config({ key: "smtp.host", default: "smtp.example.com" });
r.config({ key: "smtp.password", default: "", encrypted: true });
\`\`\`

**Siehe auch:** [Bundled-Feature \`config\`](/de/bundled-features/#config) · Recipe [\`encrypted-tenant-config\`](/de/samples/recipes/encrypted-tenant-config/)`,
    },
    en: {
      description: "Typed config key — platform default + tenant/user override, optionally encrypted.",
      body: `Declares a config key that operator/tenant can override per scope. With \`encrypted: true\` the value is stored encrypted under the master key.

\`\`\`typescript
r.config({ key: "smtp.host", default: "smtp.example.com" });
r.config({ key: "smtp.password", default: "", encrypted: true });
\`\`\`

**See also:** [Bundled feature \`config\`](/en/bundled-features/#config) · Recipe [\`encrypted-tenant-config\`](/en/samples/recipes/encrypted-tenant-config/)`,
    },
  },
  {
    kind: "translations",
    tsType: "TranslationsPattern",
    editability: "static",
    de: {
      description: "i18n-Bundle pro Feature — Labels für Nav, Screen, Field, Option.",
      body: `Hängt das Übersetzungs-Bundle des Features ein. Keys folgen der Convention \`<feature>:nav.<id>\`, \`screen:<id>.title\`, \`<feature>:entity:<entity>:field:<name>\` etc.

\`\`\`typescript
r.translations({
  de: {
    "notes:nav.list": "Notizen",
    "notes:entity:note:field:title": "Titel",
  },
  en: { /* ... */ },
});
\`\`\`

**Siehe auch:** [i18n-Konzept](/de/framework/#i18n) · Recipe [\`i18n\`](/de/samples/recipes/i18n/)`,
    },
    en: {
      description: "Per-feature i18n bundle — labels for nav, screen, field, option.",
      body: `Adds the feature's translation bundle. Keys follow the convention \`<feature>:nav.<id>\`, \`screen:<id>.title\`, \`<feature>:entity:<entity>:field:<name>\` etc.

\`\`\`typescript
r.translations({
  de: {
    "notes:nav.list": "Notizen",
    "notes:entity:note:field:title": "Titel",
  },
  en: { /* ... */ },
});
\`\`\`

**See also:** [i18n concept](/en/framework/#i18n) · Recipe [\`i18n\`](/en/samples/recipes/i18n/)`,
    },
  },
  {
    kind: "requires",
    tsType: "RequiresPattern",
    editability: "static",
    de: {
      description: "Hard-Dependency — dieses Feature läuft nur wenn die genannten Features auch geladen sind.",
      body: `Erklärt eine Pflicht-Abhängigkeit. Boot-Validation lehnt das App-Setup ab, wenn ein \`requires\`-Eintrag fehlt — kein Silent-Skip, kein Runtime-Crash.

\`\`\`typescript
r.requires(["user", "tenant"]);
\`\`\`

**Siehe auch:** [\`optionalRequires\`](/de/patterns/optionalrequires/) für weiche Abhängigkeit`,
    },
    en: {
      description: "Hard dependency — this feature only runs if the listed features are loaded too.",
      body: `Declares a mandatory dependency. Boot validation refuses the app setup when a \`requires\` entry is missing — no silent skip, no runtime crash.

\`\`\`typescript
r.requires(["user", "tenant"]);
\`\`\`

**See also:** [\`optionalRequires\`](/en/patterns/optionalrequires/) for soft dependencies`,
    },
  },
  {
    kind: "optionalRequires",
    tsType: "OptionalRequiresPattern",
    editability: "static",
    de: {
      description: "Soft-Dependency — Code reagiert wenn das andere Feature da ist, läuft auch ohne.",
      body: `Markiert weiche Abhängigkeiten. Hooks, die auf Events fremder Features reagieren, müssen ihren Trigger-Feature \`optionalRequires\`-deklarieren — sonst wird der Boot abgelehnt, sobald das Feature ohne den Trigger läuft.

\`\`\`typescript
r.optionalRequires(["audit"]);
r.hook("postSave", "post.create", async (ctx) => {
  if (ctx.has("audit")) { /* ... */ }
});
\`\`\`

**Siehe auch:** [\`requires\`](/de/patterns/requires/) für harte Abhängigkeit`,
    },
    en: {
      description: "Soft dependency — code reacts when the other feature is present, runs fine without.",
      body: `Marks soft dependencies. Hooks reacting to other features' events must \`optionalRequires\`-declare the trigger feature — otherwise the boot is rejected as soon as the feature runs without the trigger.

\`\`\`typescript
r.optionalRequires(["audit"]);
r.hook("postSave", "post.create", async (ctx) => {
  if (ctx.has("audit")) { /* ... */ }
});
\`\`\`

**See also:** [\`requires\`](/en/patterns/requires/) for hard dependencies`,
    },
  },
  {
    kind: "systemScope",
    tsType: "SystemScopePattern",
    editability: "static",
    de: {
      description: "Feature läuft im System-Scope — \`ctx.db\` ist nicht tenant-gefiltert.",
      body: `Markiert ein Feature als System-weit. Aufhebt die Default-Tenant-Filterung von \`ctx.db\`. Nutze sparsam — meist nur für Admin-Tools, Migrations, Cross-Tenant-Reports.

\`\`\`typescript
export default defineFeature("admin-tools", (r) => {
  r.systemScope();
  // ctx.db.list("tenant") gibt jetzt ALLE Tenants zurück
});
\`\`\`

**Siehe auch:** [Multi-Tenant](/de/framework/#multi-tenant)`,
    },
    en: {
      description: "Feature runs in system scope — \`ctx.db\` is not tenant-filtered.",
      body: `Marks a feature as system-wide. Removes the default tenant filter from \`ctx.db\`. Use sparingly — typically only for admin tools, migrations, cross-tenant reports.

\`\`\`typescript
export default defineFeature("admin-tools", (r) => {
  r.systemScope();
  // ctx.db.list("tenant") now returns ALL tenants
});
\`\`\`

**See also:** [Multi-tenant](/en/framework/#multi-tenant)`,
    },
  },
  {
    kind: "toggleable",
    tsType: "ToggleablePattern",
    editability: "static",
    de: {
      description: "Feature-Toggle — pro Tenant an/aus, mit Default und Code-Check.",
      body: `Deklariert einen Feature-Toggle. Operator schaltet pro Tenant um (Cache: 60 s), Code prüft via \`ctx.toggles.isOn(...)\`. Toggle-Tod aktiv mitbedenken — voll-ausgerollte Toggles wandern wieder raus.

\`\`\`typescript
r.toggleable({ id: "new-billing", default: false });

if (await ctx.toggles.isOn("new-billing")) { /* v2 */ }
\`\`\`

**Siehe auch:** [Bundled-Feature \`feature-toggles\`](/de/bundled-features/#feature-toggles)`,
    },
    en: {
      description: "Feature toggle — on/off per tenant, with default and code check.",
      body: `Declares a feature toggle. Operator switches it per tenant (cache: 60 s), code checks via \`ctx.toggles.isOn(...)\`. Plan for toggle death — fully rolled-out toggles get removed again.

\`\`\`typescript
r.toggleable({ id: "new-billing", default: false });

if (await ctx.toggles.isOn("new-billing")) { /* v2 */ }
\`\`\`

**See also:** [Bundled feature \`feature-toggles\`](/en/bundled-features/#feature-toggles)`,
    },
  },
  {
    kind: "metric",
    tsType: "MetricPattern",
    editability: "static",
    de: {
      description: "Counter / Gauge / Histogram — Telemetry-Metric mit typisierten Labels.",
      body: `Registriert eine Observability-Metric. Der Provider (OTel, Prometheus, …) wird beim Boot gewählt; das Feature kennt nur das Pattern.

\`\`\`typescript
const incidentsOpened = r.metric("incidents_opened", {
  type: "counter",
  description: "Anzahl neu eröffneter Incidents",
});

r.hook("postSave", "incident.create", () => incidentsOpened.inc());
\`\`\``,
    },
    en: {
      description: "Counter / gauge / histogram — telemetry metric with typed labels.",
      body: `Registers an observability metric. The provider (OTel, Prometheus, …) is picked at boot time; the feature only knows the pattern.

\`\`\`typescript
const incidentsOpened = r.metric("incidents_opened", {
  type: "counter",
  description: "Number of newly opened incidents",
});

r.hook("postSave", "incident.create", () => incidentsOpened.inc());
\`\`\``,
    },
  },
  {
    kind: "secret",
    tsType: "SecretPattern",
    editability: "static",
    de: {
      description: "Per-Tenant verschlüsseltes Secret — API-Keys, OAuth-Tokens, Webhook-Pässe.",
      body: `Deklariert einen Secret-Slot. Werte liegen envelope-encrypted in \`tenant_secrets\`, jeder Read emittiert ein Audit-Event. Nutze \`secret\` für externe Service-Credentials, \`config encrypted\` für operator-pflegbare Settings.

\`\`\`typescript
r.secret({ key: "stripe.api_key" });

const apiKey = await ctx.secrets.read("stripe.api_key");
\`\`\`

**Siehe auch:** [Bundled-Feature \`secrets\`](/de/bundled-features/#secrets) · Recipe [\`encrypted-tenant-config\`](/de/samples/recipes/encrypted-tenant-config/)`,
    },
    en: {
      description: "Per-tenant encrypted secret — API keys, OAuth tokens, webhook passwords.",
      body: `Declares a secret slot. Values live envelope-encrypted in \`tenant_secrets\`; every read emits an audit event. Use \`secret\` for external service credentials, \`config encrypted\` for operator-maintained settings.

\`\`\`typescript
r.secret({ key: "stripe.api_key" });

const apiKey = await ctx.secrets.read("stripe.api_key");
\`\`\`

**See also:** [Bundled feature \`secrets\`](/en/bundled-features/#secrets) · Recipe [\`encrypted-tenant-config\`](/en/samples/recipes/encrypted-tenant-config/)`,
    },
  },
  {
    kind: "claimKey",
    tsType: "ClaimKeyPattern",
    editability: "static",
    de: {
      description: "Custom JWT-Claim-Key — typisierte Identity-Facts, die ins Auth-Token wandern.",
      body: `Deklariert einen Custom-Claim-Key, den ein \`r.authClaims(...)\`-Hook befüllt und Handler über \`ctx.user.claims[key]\` typed lesen.

\`\`\`typescript
const orgRole = r.claimKey("orgRole", "string");
r.authClaims(async (ctx, user) => ({ [orgRole.name]: await lookupRole(user.id) }));
\`\`\`

**Siehe auch:** [\`authClaims\`](/de/patterns/authclaims/) · Recipe [\`auth-claims\`](/de/samples/recipes/auth-claims/)`,
    },
    en: {
      description: "Custom JWT claim key — typed identity facts that travel inside the auth token.",
      body: `Declares a custom claim key, populated by an \`r.authClaims(...)\` hook, read in handlers via \`ctx.user.claims[key]\` (typed).

\`\`\`typescript
const orgRole = r.claimKey("orgRole", "string");
r.authClaims(async (ctx, user) => ({ [orgRole.name]: await lookupRole(user.id) }));
\`\`\`

**See also:** [\`authClaims\`](/en/patterns/authclaims/) · Recipe [\`auth-claims\`](/en/samples/recipes/auth-claims/)`,
    },
  },
  {
    kind: "referenceData",
    tsType: "ReferenceDataPattern",
    editability: "static",
    de: {
      description: "Stammdaten — deklarative Seeds, die beim Boot in die DB upserted werden.",
      body: `Deklariert Stammdaten (Länder, Kategorien, Default-Rollen, …). Beim Boot/Migrate werden sie via \`upsertKey\` idempotent in die Tabelle geschrieben.

\`\`\`typescript
r.referenceData({
  entity: "country",
  upsertKey: "iso2",
  data: [
    { iso2: "DE", name: "Deutschland" },
    { iso2: "AT", name: "Österreich" },
  ],
});
\`\`\`

**Siehe auch:** Recipe [\`reference-data\`](/de/samples/recipes/reference-data/)`,
    },
    en: {
      description: "Reference data — declarative seeds that get upserted into the DB at boot.",
      body: `Declares reference data (countries, categories, default roles, …). At boot/migrate they are idempotently written to the table via \`upsertKey\`.

\`\`\`typescript
r.referenceData({
  entity: "country",
  upsertKey: "iso2",
  data: [
    { iso2: "DE", name: "Germany" },
    { iso2: "AT", name: "Austria" },
  ],
});
\`\`\`

**See also:** Recipe [\`reference-data\`](/en/samples/recipes/reference-data/)`,
    },
  },
  {
    kind: "readsConfig",
    tsType: "ReadsConfigPattern",
    editability: "static",
    de: {
      description: "Deklariert: dieses Feature liest die folgenden Config-Keys.",
      body: `Markiert die Config-Keys, die ein Feature liest. Boot-Validation prüft: jeder gelesene Key ist deklariert, jeder deklarierte Key existiert. Verhindert Silent-Drift zwischen \`r.config\` und Resolver-Aufrufen.

\`\`\`typescript
r.readsConfig(["smtp.host", "smtp.password"]);
\`\`\`

**Siehe auch:** [\`config\`](/de/patterns/config/)`,
    },
    en: {
      description: "Declares: this feature reads the following config keys.",
      body: `Marks the config keys a feature reads. Boot validation checks: every key read is declared, every declared key exists. Prevents silent drift between \`r.config\` and resolver calls.

\`\`\`typescript
r.readsConfig(["smtp.host", "smtp.password"]);
\`\`\`

**See also:** [\`config\`](/en/patterns/config/)`,
    },
  },
  {
    kind: "useExtension",
    tsType: "UseExtensionPattern",
    editability: "static",
    de: {
      description: "Aktiviert eine Registrar-Extension auf einer Entity (z. B. softDelete, archive).",
      body: `Hängt eine Registrar-Extension an eine Entity. Extensions kommen aus dem Framework (\`softDelete\`, \`archive\`, \`workflow\`) oder aus einem Bundled-Feature.

\`\`\`typescript
r.useExtension("softDelete", "post");
r.useExtension("archive", "incident", { archiveAfterDays: 90 });
\`\`\`

**Siehe auch:** [\`extendsRegistrar\`](/de/patterns/extendsregistrar/) für eigene Extensions`,
    },
    en: {
      description: "Activates a registrar extension on an entity (e.g. softDelete, archive).",
      body: `Attaches a registrar extension to an entity. Extensions come from the framework (\`softDelete\`, \`archive\`, \`workflow\`) or from a bundled feature.

\`\`\`typescript
r.useExtension("softDelete", "post");
r.useExtension("archive", "incident", { archiveAfterDays: 90 });
\`\`\`

**See also:** [\`extendsRegistrar\`](/en/patterns/extendsregistrar/) for custom extensions`,
    },
  },
  {
    kind: "screen",
    tsType: "ScreenPattern",
    editability: "mixed",
    de: {
      description: "Screen-Definition — entityList, entityEdit oder custom React-Screen.",
      body: `Registriert einen Screen. Drei Typen: \`entityList\` (Tabellen-Screen aus Schema), \`entityEdit\` (Form-Screen aus Schema), \`custom\` (eigener React-Tree).

\`\`\`typescript
r.screen({
  id: "note-list",
  type: "entityList",
  entity: "note",
  columns: ["title", "tag", "pinned"],
  defaultSort: { field: "title", dir: "asc" },
});
\`\`\`

**Siehe auch:** [Rendering-Konzept](/de/framework/#rendering) · Recipe [\`screens-nav\`](/de/samples/recipes/screens-nav/)`,
    },
    en: {
      description: "Screen definition — entityList, entityEdit or custom React screen.",
      body: `Registers a screen. Three types: \`entityList\` (table screen from schema), \`entityEdit\` (form screen from schema), \`custom\` (your own React tree).

\`\`\`typescript
r.screen({
  id: "note-list",
  type: "entityList",
  entity: "note",
  columns: ["title", "tag", "pinned"],
  defaultSort: { field: "title", dir: "asc" },
});
\`\`\`

**See also:** [Rendering concept](/en/framework/#rendering) · Recipe [\`screens-nav\`](/en/samples/recipes/screens-nav/)`,
    },
  },
  {
    kind: "writeHandler",
    tsType: "WriteHandlerPattern",
    editability: "mixed",
    de: {
      description: "Command-Handler — Schema, Access-Check, Body. Schreibt durch die Pipeline.",
      body: `Registriert einen Write-Handler. Schema (Zod) + Access-Rules sind deklarativ; der Handler-Body ist beliebiger TypeScript-Code, läuft innerhalb der Pipeline (Validation → Access → Body → postSave-Hooks → SSE).

\`\`\`typescript
r.writeHandler({
  qn: "note:archive",
  schema: z.object({ id: z.string() }),
  access: { roles: ["User", "Admin"] },
  handler: async (ctx, { id }) => {
    await ctx.db.update("note", id, { archived: true });
  },
});
\`\`\`

**Siehe auch:** [Pipeline-Konzept](/de/framework/#pipeline) · Recipe [\`custom-handlers\`](/de/samples/recipes/custom-handlers/)`,
    },
    en: {
      description: "Command handler — schema, access check, body. Writes through the pipeline.",
      body: `Registers a write handler. Schema (Zod) + access rules are declarative; the handler body is arbitrary TypeScript, executed inside the pipeline (validation → access → body → postSave hooks → SSE).

\`\`\`typescript
r.writeHandler({
  qn: "note:archive",
  schema: z.object({ id: z.string() }),
  access: { roles: ["User", "Admin"] },
  handler: async (ctx, { id }) => {
    await ctx.db.update("note", id, { archived: true });
  },
});
\`\`\`

**See also:** [Pipeline concept](/en/framework/#pipeline) · Recipe [\`custom-handlers\`](/en/samples/recipes/custom-handlers/)`,
    },
  },
  {
    kind: "queryHandler",
    tsType: "QueryHandlerPattern",
    editability: "mixed",
    de: {
      description: "Read-Handler — Schema, Access-Check, Body. Liest durch die Pipeline.",
      body: `Registriert einen Read-Handler. Wie Write, aber ohne postSave/SSE-Stage. Field-Level-Read-Access wird automatisch nach dem Body angewendet.

\`\`\`typescript
r.queryHandler({
  qn: "note:list",
  schema: z.object({ tag: z.string().optional() }),
  access: { roles: ["User"] },
  handler: async (ctx, { tag }) => ctx.db.list("note", { where: { tag } }),
});
\`\`\`

**Siehe auch:** [Pipeline-Konzept](/de/framework/#pipeline)`,
    },
    en: {
      description: "Read handler — schema, access check, body. Reads through the pipeline.",
      body: `Registers a read handler. Like write, but without the postSave/SSE stage. Field-level read access is applied automatically after the body.

\`\`\`typescript
r.queryHandler({
  qn: "note:list",
  schema: z.object({ tag: z.string().optional() }),
  access: { roles: ["User"] },
  handler: async (ctx, { tag }) => ctx.db.list("note", { where: { tag } }),
});
\`\`\`

**See also:** [Pipeline concept](/en/framework/#pipeline)`,
    },
  },
  {
    kind: "hook",
    tsType: "HookPattern",
    editability: "mixed",
    de: {
      description: "Lifecycle-Hook — preSave, postSave, validation auf einen oder mehrere Targets.",
      body: `Hängt Custom-Logik in die Pipeline. Drei Phasen: \`validation\` (vor DB), \`preSave\` (Daten anpassen), \`postSave\` (Side-Effects, läuft in derselben TX).

\`\`\`typescript
r.hook("preSave", "post.create", async (ctx, { data, changes }) => {
  if (!changes.slug && changes.title) {
    return { ...data, slug: slugify(changes.title) };
  }
  return data;
});
\`\`\`

**Siehe auch:** [Lifecycle](/de/architecture/lifecycle/) · Recipe [\`lifecycle-hooks\`](/de/samples/recipes/lifecycle-hooks/)`,
    },
    en: {
      description: "Lifecycle hook — preSave, postSave, validation on one or more targets.",
      body: `Hooks custom logic into the pipeline. Three phases: \`validation\` (pre-DB), \`preSave\` (mutate data), \`postSave\` (side effects, runs in the same TX).

\`\`\`typescript
r.hook("preSave", "post.create", async (ctx, { data, changes }) => {
  if (!changes.slug && changes.title) {
    return { ...data, slug: slugify(changes.title) };
  }
  return data;
});
\`\`\`

**See also:** [Lifecycle](/en/architecture/lifecycle/) · Recipe [\`lifecycle-hooks\`](/en/samples/recipes/lifecycle-hooks/)`,
    },
  },
  {
    kind: "entityHook",
    tsType: "EntityHookPattern",
    editability: "mixed",
    de: {
      description: "Entity-bezogener Lifecycle-Hook — postSave / preDelete / postDelete pro Entity.",
      body: `Spezial-Variante von \`r.hook\` für eine konkrete Entity, ohne den \`<entity>.<verb>\`-Target string. Compiler typt \`data\` automatisch.

\`\`\`typescript
r.entityHook("postSave", "incident", async (ctx, { id, data }) => {
  await ctx.delivery.send({ to: data.assigneeId, template: "incident-assigned" });
});
\`\`\`

**Siehe auch:** [\`hook\`](/de/patterns/hook/)`,
    },
    en: {
      description: "Entity-scoped lifecycle hook — postSave / preDelete / postDelete per entity.",
      body: `Special variant of \`r.hook\` for one specific entity, without the \`<entity>.<verb>\` target string. The compiler types \`data\` automatically.

\`\`\`typescript
r.entityHook("postSave", "incident", async (ctx, { id, data }) => {
  await ctx.delivery.send({ to: data.assigneeId, template: "incident-assigned" });
});
\`\`\`

**See also:** [\`hook\`](/en/patterns/hook/)`,
    },
  },
  {
    kind: "job",
    tsType: "JobPattern",
    editability: "mixed",
    de: {
      description: "Background-Job — Cron, Event-getrieben oder manuell. Lane-Routing api/worker.",
      body: `Registriert einen Background-Job (BullMQ + Redis). Trigger: Cron-Schedule, Domain-Event oder manueller \`ctx.jobs.enqueue\`. Lane: \`api\` (im HTTP-Prozess) oder \`worker\` (separater Pool).

\`\`\`typescript
r.job({
  id: "cleanup-old-attempts",
  runIn: "worker",
  schedule: "0 3 * * *",
  handler: async (ctx) => { /* DELETE WHERE created_at < ... */ },
});
\`\`\`

**Siehe auch:** [Bundled-Feature \`jobs\`](/de/bundled-features/#jobs) · Recipe [\`lane-routing\`](/de/samples/recipes/lane-routing/)`,
    },
    en: {
      description: "Background job — cron, event-driven or manual. Lane routing api/worker.",
      body: `Registers a background job (BullMQ + Redis). Triggers: cron schedule, domain event or manual \`ctx.jobs.enqueue\`. Lane: \`api\` (in the HTTP process) or \`worker\` (separate pool).

\`\`\`typescript
r.job({
  id: "cleanup-old-attempts",
  runIn: "worker",
  schedule: "0 3 * * *",
  handler: async (ctx) => { /* DELETE WHERE created_at < ... */ },
});
\`\`\`

**See also:** [Bundled feature \`jobs\`](/en/bundled-features/#jobs) · Recipe [\`lane-routing\`](/en/samples/recipes/lane-routing/)`,
    },
  },
  {
    kind: "notification",
    tsType: "NotificationPattern",
    editability: "mixed",
    de: {
      description: "Notification-Definition — Trigger-Event + Empfänger-Closure + Daten + Templates.",
      body: `Bindet eine Notification an ein Domain-Event. Empfänger und Daten kommen aus Closures, Templates pro Channel (Email, In-App, Push).

\`\`\`typescript
r.notification({
  name: "incident-created",
  trigger: { on: "incident.created" },
  recipient: async (ctx, event) => ctx.subscribers(event.data.componentId),
  data: async (_, event) => ({ title: event.data.title }),
  templates: { email: emailTemplate, inApp: inAppTemplate },
});
\`\`\`

**Siehe auch:** [Bundled-Feature \`delivery\`](/de/bundled-features/#delivery) · Recipe [\`delivery-notifications\`](/de/samples/recipes/delivery-notifications/)`,
    },
    en: {
      description: "Notification definition — trigger event + recipient closure + data + templates.",
      body: `Binds a notification to a domain event. Recipient and data come from closures; templates per channel (email, in-app, push).

\`\`\`typescript
r.notification({
  name: "incident-created",
  trigger: { on: "incident.created" },
  recipient: async (ctx, event) => ctx.subscribers(event.data.componentId),
  data: async (_, event) => ({ title: event.data.title }),
  templates: { email: emailTemplate, inApp: inAppTemplate },
});
\`\`\`

**See also:** [Bundled feature \`delivery\`](/en/bundled-features/#delivery) · Recipe [\`delivery-notifications\`](/en/samples/recipes/delivery-notifications/)`,
    },
  },
  {
    kind: "authClaims",
    tsType: "AuthClaimsPattern",
    editability: "opaque",
    de: {
      description: "Hook der Identity-Facts beim Login in den JWT schreibt.",
      body: `Lädt zusätzliche Claims in den JWT. Wird einmal pro Login aufgerufen, läuft in einem reinen Read-Context (kein Write erlaubt).

\`\`\`typescript
r.authClaims(async (ctx, user) => ({
  orgRole: await lookupRole(user.id),
  beta: user.email.endsWith("@example.com"),
}));
\`\`\`

**Siehe auch:** [\`claimKey\`](/de/patterns/claimkey/) · Recipe [\`auth-claims\`](/de/samples/recipes/auth-claims/)`,
    },
    en: {
      description: "Hook that writes identity facts into the JWT on login.",
      body: `Loads additional claims into the JWT. Called once per login, runs in a read-only context (no writes allowed).

\`\`\`typescript
r.authClaims(async (ctx, user) => ({
  orgRole: await lookupRole(user.id),
  beta: user.email.endsWith("@example.com"),
}));
\`\`\`

**See also:** [\`claimKey\`](/en/patterns/claimkey/) · Recipe [\`auth-claims\`](/en/samples/recipes/auth-claims/)`,
    },
  },
  {
    kind: "httpRoute",
    tsType: "HttpRoutePattern",
    editability: "mixed",
    de: {
      description: "Custom HTTP-Route außerhalb der Command-/Query-Pipeline (Webhooks, Health, Files).",
      body: `Hängt eine eigene HTTP-Route an die Hono-App. Nutze sparsam — die Standard-Pipeline ist die First-Class-Wahl. Routes sind für Webhooks, OAuth-Callbacks, File-Streaming, Health-Checks.

\`\`\`typescript
r.httpRoute({
  method: "POST",
  path: "/webhooks/stripe",
  anonymous: true,
  handler: async (ctx, req) => { /* verify signature, dispatch event */ },
});
\`\`\``,
    },
    en: {
      description: "Custom HTTP route outside the command/query pipeline (webhooks, health, files).",
      body: `Adds a custom HTTP route to the Hono app. Use sparingly — the standard pipeline is the first-class option. Routes are for webhooks, OAuth callbacks, file streaming, health checks.

\`\`\`typescript
r.httpRoute({
  method: "POST",
  path: "/webhooks/stripe",
  anonymous: true,
  handler: async (ctx, req) => { /* verify signature, dispatch event */ },
});
\`\`\``,
    },
  },
  {
    kind: "projection",
    tsType: "ProjectionPattern",
    editability: "mixed",
    de: {
      description: "Single-Stream-Read-Model — Inline in der Write-TX, immer konsistent.",
      body: `Inline-Read-Model für eine einzelne Entity. Der Apply-Body läuft in derselben Transaktion wie der Write — Read-Model und Event-Log können nicht auseinanderlaufen.

\`\`\`typescript
r.projection({
  name: "post-summary",
  sourceEntity: "post",
  apply: {
    "post.created": (state, event) => ({ ...state, count: state.count + 1 }),
  },
});
\`\`\`

**Siehe auch:** [Event-Sourcing-Konzept](/de/framework/#event-sourcing)`,
    },
    en: {
      description: "Single-stream read model — inline in the write TX, always consistent.",
      body: `Inline read model for a single entity. The apply body runs in the same transaction as the write — read model and event log cannot diverge.

\`\`\`typescript
r.projection({
  name: "post-summary",
  sourceEntity: "post",
  apply: {
    "post.created": (state, event) => ({ ...state, count: state.count + 1 }),
  },
});
\`\`\`

**See also:** [Event-sourcing concept](/en/framework/#event-sourcing)`,
    },
  },
  {
    kind: "multiStreamProjection",
    tsType: "MultiStreamProjectionPattern",
    editability: "mixed",
    de: {
      description: "Cross-Aggregate-Read-Model — async, hört auf Events aus mehreren Streams.",
      body: `Async-Read-Model das Events aus mehreren Aggregaten/Features aufnimmt. Lane (\`api\`/\`worker\`), Delivery-Mode (\`shared\`/\`per-instance\`) und Error-Mode konfigurierbar.

\`\`\`typescript
r.multiStreamProjection({
  name: "incident-stats",
  apply: {
    "incident.created": (s) => ({ ...s, open: s.open + 1 }),
    "incident.resolved": (s) => ({ ...s, open: s.open - 1 }),
  },
  runIn: "worker",
});
\`\`\`

**Siehe auch:** Recipe [\`cross-feature-events\`](/de/samples/recipes/cross-feature-events/)`,
    },
    en: {
      description: "Cross-aggregate read model — async, listens to events from multiple streams.",
      body: `Async read model consuming events from several aggregates/features. Lane (\`api\`/\`worker\`), delivery mode (\`shared\`/\`per-instance\`) and error mode are configurable.

\`\`\`typescript
r.multiStreamProjection({
  name: "incident-stats",
  apply: {
    "incident.created": (s) => ({ ...s, open: s.open + 1 }),
    "incident.resolved": (s) => ({ ...s, open: s.open - 1 }),
  },
  runIn: "worker",
});
\`\`\`

**See also:** Recipe [\`cross-feature-events\`](/en/samples/recipes/cross-feature-events/)`,
    },
  },
  {
    kind: "defineEvent",
    tsType: "DefineEventPattern",
    editability: "mixed",
    de: {
      description: "Custom-Domain-Event mit Zod-Schema, Versions-Nummer und Upcaster-Kette.",
      body: `Definiert ein typisiertes Domain-Event. Das Schema landet im Boot-Validator (Compatibility-Check). \`migrations\` migriert alte Event-Versionen on-read in die aktuelle Schema-Version — Append-only-Log bleibt unverändert, der Upcaster läuft beim Lesen vor dem Apply.

\`\`\`typescript
const incidentResolved = r.defineEvent("incident.resolved", z.object({ resolution: z.string(), resolvedAt: z.date() }), {
  version: 2,
  migrations: [
    { fromVersion: 1, toVersion: 2, transform: (oldPayload) => ({ ...oldPayload, resolvedBy: "system" }) },
  ],
});

await ctx.appendEvent(incidentResolved, id, { resolution, resolvedAt: new Date() });
\`\`\`

**Siehe auch:** Recipe [\`event-sourcing\`](/de/samples/recipes/event-sourcing/)`,
    },
    en: {
      description: "Custom domain event with Zod schema, version number, and upcaster chain.",
      body: `Defines a typed domain event. The schema is checked by the boot validator (compatibility check). \`migrations\` upcasts old event versions on read into the current schema version — the append-only log stays unchanged, the upcaster runs at read time before apply.

\`\`\`typescript
const incidentResolved = r.defineEvent("incident.resolved", z.object({ resolution: z.string(), resolvedAt: z.date() }), {
  version: 2,
  migrations: [
    { fromVersion: 1, toVersion: 2, transform: (oldPayload) => ({ ...oldPayload, resolvedBy: "system" }) },
  ],
});

await ctx.appendEvent(incidentResolved, id, { resolution, resolvedAt: new Date() });
\`\`\`

**See also:** Recipe [\`event-sourcing\`](/en/samples/recipes/event-sourcing/)`,
    },
  },
  {
    kind: "extendsRegistrar",
    tsType: "ExtendsRegistrarPattern",
    editability: "opaque",
    de: {
      description: "Meta-Pattern — eigene \`r.<custom>(...)\`-Methode definieren.",
      body: `Erweitert den Registrar um eine eigene \`r.foo(...)\`-Methode. Power-User-Surface — fast alle Apps brauchen das nie. Nutze \`useExtension\` für vorgefertigte Extensions.

\`\`\`typescript
r.extendsRegistrar("workflow", (def) => { /* registriert mehrere internals */ });
\`\`\`

**Siehe auch:** [\`useExtension\`](/de/patterns/useextension/)`,
    },
    en: {
      description: "Meta pattern — define your own \`r.<custom>(...)\` method.",
      body: `Extends the registrar with a custom \`r.foo(...)\` method. Power-user surface — most apps never need this. Use \`useExtension\` for ready-made extensions.

\`\`\`typescript
r.extendsRegistrar("workflow", (def) => { /* registers several internals */ });
\`\`\`

**See also:** [\`useExtension\`](/en/patterns/useextension/)`,
    },
  },
  {
    kind: "unknown",
    tsType: "UnknownPattern",
    editability: "opaque",
    de: {
      description: "Catch-all — \`r.<call>\` den der AST-Visitor (noch) nicht kennt.",
      body: `Tritt auf, wenn der AST-Visitor einen \`r.<call>\` sieht, für den noch kein eigener Pattern-Type existiert. Designer rendert "custom call (read-only)", AI-Patcher lässt den Block unverändert. Hinweis an die Framework-Devs: hier fehlt ein Pattern-Type.

\`\`\`typescript
r.experimentalThing({ /* ... */ });   // → UnknownPattern
\`\`\``,
    },
    en: {
      description: "Catch-all — an \`r.<call>\` the AST visitor doesn't (yet) recognise.",
      body: `Emitted when the AST visitor sees an \`r.<call>\` for which no dedicated pattern type exists. The Designer renders "custom call (read-only)", the AI patcher leaves the block untouched. Signal to framework devs: a pattern type is missing.

\`\`\`typescript
r.experimentalThing({ /* ... */ });   // → UnknownPattern
\`\`\``,
    },
  },
];

// -------------------------------------------------------------------------
// Render

function renderMdx(p: PatternDoc, locale: "de" | "en"): string {
  const t = locale === "de" ? p.de : p.en;
  const labelKind = locale === "de" ? "Pattern-Kind" : "Pattern kind";
  const labelType = locale === "de" ? "TS-Type" : "TS type";
  const labelEdit = locale === "de" ? "Editierbarkeit" : "Editability";
  const labelSource = locale === "de" ? "Quelle" : "Source";
  return `---
title: "r.${p.kind}(...)"
description: "${t.description}"
---

import { Aside } from '@astrojs/starlight/components';

${t.body}

<Aside type="note">
**${labelKind}:** \`${p.kind}\` — **${labelType}:** \`${p.tsType}\` — **${labelEdit}:** \`${p.editability}\`
</Aside>

---

_${labelSource}: \`packages/framework/src/engine/feature-ast/patterns.ts\` → \`${p.tsType}\`_
`;
}

// -------------------------------------------------------------------------
// Write

// kumiko/scripts/regenerate-pattern-docs.ts → kumiko/platform/apps/docs/...
// `platform` ist ein Symlink auf den parallel ausgecheckten
// `kumiko-platform`-Repo, also schreibt der Generator de-facto dort hin.
const REPO_ROOT = resolve(import.meta.dir, "..");
const DOCS_BASE = join(REPO_ROOT, "platform/apps/docs/src/content/docs");
const baseDe = join(DOCS_BASE, "de/patterns");
const baseEn = join(DOCS_BASE, "en/patterns");
mkdirSync(baseDe, { recursive: true });
mkdirSync(baseEn, { recursive: true });

let written = 0;
for (const p of PATTERNS) {
  writeFileSync(join(baseDe, `${p.kind}.mdx`), renderMdx(p, "de"));
  writeFileSync(join(baseEn, `${p.kind}.mdx`), renderMdx(p, "en"));
  written += 2;
}

console.log(`Wrote ${written} pattern docs (${PATTERNS.length} kinds × 2 locales).`);

// -------------------------------------------------------------------------
// Smoke-Validation
//
// Starlight slugifiziert File-Namen auf lowercase, also wird
// `claimKey.mdx` zu `/patterns/claimkey/`. Die Cross-Link-URLs in den
// Bodies müssen das treffen — ein Tippfehler oder vergessenes
// lowercase-Match führt zum 404 ohne Build-Warning. Diese Validation
// fängt das vor dem Commit.
//
// Pro `/de/patterns/<x>/` oder `/en/patterns/<x>/`-Link im Body wird
// geprüft, ob `<x>` (case-insensitive) auf einen wirklich geschriebenen
// File matched. Recipe-/Framework-/Architecture-Links werden NICHT
// validiert — die leben außerhalb der Generator-Verantwortung.

const PATTERN_LINK_RE = /\/(?:de|en)\/patterns\/([a-z0-9-]+)\//gi;
const writtenSlugs = new Set(
  [...readdirSync(baseDe), ...readdirSync(baseEn)]
    .filter((f) => f.endsWith(".mdx"))
    .map((f) => f.replace(/\.mdx$/, "").toLowerCase()),
);

const broken: string[] = [];
for (const p of PATTERNS) {
  for (const locale of ["de", "en"] as const) {
    const body = locale === "de" ? p.de.body : p.en.body;
    const matches = body.matchAll(PATTERN_LINK_RE);
    for (const [fullMatch, slug] of matches) {
      if (!writtenSlugs.has(slug.toLowerCase())) {
        broken.push(`${p.kind}.mdx (${locale}) → ${fullMatch} — kein File mit slug "${slug}"`);
      }
    }
  }
}

if (broken.length > 0) {
  console.error(`\n❌ ${broken.length} Broken Pattern-Cross-Link(s):`);
  for (const b of broken) console.error(`  ${b}`);
  console.error(
    `\nFix: in PATTERNS-Array die URL anpassen — Starlight slugifiziert ` +
      `Files auf lowercase, also "/patterns/claimkey/" für claimKey.mdx.`,
  );
  process.exit(1);
}

console.log(`✓ Smoke-Validation: alle Pattern-Cross-Links treffen existierende Files.`);

// Sanity-Check: existiert eine patterns.ts und stimmt die Anzahl der
// Pattern-Kinds einigermaßen überein? Drift-Frühwarnung — wenn jemand
// `patterns.ts` erweitert ohne dieses Script zu pflegen.
const PATTERNS_TS = join(
  REPO_ROOT,
  "packages/framework/src/engine/feature-ast/patterns.ts",
);
if (existsSync(PATTERNS_TS)) {
  const file = await Bun.file(PATTERNS_TS).text();
  const declaredKinds = [...file.matchAll(/readonly kind: "([a-zA-Z]+)"/g)].map(
    (m) => m[1],
  );
  const documented = new Set(PATTERNS.map((p) => p.kind));
  const missing = declaredKinds.filter((k) => !documented.has(k));
  if (missing.length > 0) {
    console.warn(
      `\n⚠ patterns.ts deklariert ${missing.length} Kind(s), die hier ` +
        `kein Doc haben: ${missing.join(", ")}`,
    );
    console.warn(`  → ergänze sie im PATTERNS-Array dieses Scripts.`);
  } else {
    console.log(`✓ Doc-Coverage: alle ${declaredKinds.length} Kinds aus patterns.ts dokumentiert.`);
  }
}
