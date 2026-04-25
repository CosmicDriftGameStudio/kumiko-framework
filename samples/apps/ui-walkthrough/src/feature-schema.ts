// Feature schema — shared between client and server. Client-safe:
// no handler registrations, no pipeline wiring, no DB calls. Just
// the static shape (entity + screens) that both sides need to agree
// on. The server's feature.ts imports from here and wires the
// runtime side (r.writeHandler / r.queryHandler / r.screen); the
// client's client.tsx imports from here and hands the whole bundle
// to createKumikoApp.
//
// Duplication-concern: yes, the screens are re-listed in feature.ts
// when wiring them through r.screen(). For M2 this is intentional —
// the split pins which file pulls Node-only framework internals
// (feature.ts) and which stays bundler-clean (this one). Later, a
// tree-shakeable `defineFeature` could let the client import a shared
// feature file directly.

import type {
  EntityDefinition,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
} from "@kumiko/framework/ui-types";
import type { FeatureSchema } from "@kumiko/renderer-web";

// Entity — cast at the boundary. `createEntity` from framework/engine
// would read nicer here, but its import path pulls the full framework
// runtime; that's a later cleanup. The literal shape is what the
// server's `r.entity(...)` call also passes.
export const taskEntity = {
  table: "read_ui_walkthrough_tasks",

  fields: {
    title: { type: "text", required: true, sortable: true },
    status: { type: "text", sortable: true },
    priority: { type: "number" },
    isUrgent: { type: "boolean", default: false },
    notes: { type: "text" },
  },
} as unknown as EntityDefinition;

// Screens carry SHORT ids here — the registry qualifies them to
// `${featureName}:screen:${id}` on r.screen() ingest. createKumikoApp
// qualifies consistently on lookup, so the client and the server see
// the same qualified names at runtime.
export const editScreen: EntityEditScreenDefinition = {
  id: "task-edit",
  type: "entityEdit",
  entity: "task",
  layout: {
    sections: [
      {
        title: "Task basics",
        columns: 2,
        fields: [
          { field: "title", span: 2 },
          "status",
          "priority",
          "isUrgent",
          {
            field: "notes",
            span: 2,
            visible: (d) => (d as { isUrgent?: boolean }).isUrgent === true,
            required: (d) => (d as { isUrgent?: boolean }).isUrgent === true,
          },
        ],
      },
    ],
  },
};

export const listScreen: EntityListScreenDefinition = {
  id: "task-list",
  type: "entityList",
  entity: "task",
  columns: [
    "title",
    "status",
    "isUrgent",
    {
      field: "priority",
      renderer: (v: unknown) => (v === undefined || v === 0 ? "—" : `P${v}`),
    },
  ],
};

// The schema that createKumikoApp consumes on the client side.
// Listing the edit-screen first puts it at position 0 so the app's
// landing page is the form; the list is reached via explicit screenQn
// (URL-routing comes later). The list can also become the default by
// flipping the order here.
// Nav-Einträge — flache Liste, der NavTree qualifiziert die ids
// client-seitig zur `tasks:nav:<id>` / `tasks:screen:<id>` Form.
// Auf dem Server würde derselbe Feature dieselben Einträge via
// r.nav(...) registrieren; hier genügt die client-Deklaration, weil
// wir noch keine Server-Nav-Resolver-Pipeline durchreichen.
export const clientSchema: FeatureSchema = {
  featureName: "tasks",
  entities: { task: taskEntity },
  screens: [editScreen, listScreen],
  // i18n-Keys statt Literal-Strings — NavTree leitet sie durch
  // useTranslation(), das Sample liefert die passenden Bundles als
  // Client-Feature (siehe appTranslations in client.tsx).
  navs: [
    { id: "task-list", label: "tasks.nav.list", screen: "task-list", order: 10 },
    { id: "task-new", label: "tasks.nav.new", screen: "task-edit", order: 20 },
  ],
};
