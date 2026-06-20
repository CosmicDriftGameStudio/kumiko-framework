// Config-Stresstest für die EINE Nav (Visual-Tree-Merge): ein statischer
// `Content`-Knoten der seine Children zur Laufzeit aus einem nav-provider
// zieht + ein „+" zum Anlegen. Beweist den Kern: neue Seite anlegen → per
// SSE (treeEntities) erscheint sie LIVE im Sidebar-Tree, ohne Re-Mount.
//
// Die Server-Seite ist absichtlich minimal (slug + title): es geht um die
// Nav-Mechanik, nicht um ein zweites text-content. P4 zieht text-content
// selbst auf genau dieses Muster um.

import {
  createEntity,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDetailHandler,
  defineEntityListHandler,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";

export const pageEntity = createEntity({
  table: "read_content_pages",
  fields: {
    slug: createTextField({ required: true }),
    title: createTextField({ required: true }),
  },
});

const open = { access: { openToAll: true } } as const;

export const contentFeature = defineFeature("content", (r) => {
  r.entity("page", pageEntity);
  r.writeHandler(defineEntityCreateHandler("page", pageEntity, open));
  r.queryHandler(defineEntityListHandler("page", pageEntity, open));
  r.queryHandler(defineEntityDetailHandler("page", pageEntity, open));

  // Der dynamische Nav-Knoten: KEIN screen, sondern `provider: true` →
  // Children kommen aus dem client-seitigen navProvider (siehe web.tsx),
  // lazy beim Ausklappen + SSE-live. Das „+" dispatcht ein leeres
  // content:edit-Target → der Resolver zeigt das Anlege-Formular.
  r.nav({
    id: "content",
    label: "Content",
    icon: "folder",
    order: 40,
    provider: true,
    createAction: {
      icon: "plus",
      label: "New page",
      target: { featureId: "content", action: "edit", args: {} },
    },
  });
});
