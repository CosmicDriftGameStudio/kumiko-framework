// Widgets-Feature (server). Eine custom-Screen, die das Mid-Level-Widget-Kit
// zeigt (StatCard, SectionCard, Charts, StatusBadge, …) — der visuelle
// Katalog für App-Autoren und die e2e-Fläche der Widgets.

import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const widgetsFeature = defineFeature("widgets", (r) => {
  r.screen({ id: "widgets", type: "custom", renderer: { react: { __component: "widgets" } } });

  r.nav({
    id: "widgets",
    label: "Widgets",
    parent: "gallery:nav:styleguide",
    screen: "widgets:screen:widgets",
    icon: "layout-grid",
    order: 20,
  });
});
